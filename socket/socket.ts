/// <reference path="../types/express/index.d.ts" />

import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import redis from '../config/redis';
import prisma from '../config/prisma';

// A map to store active connections (userId -> WebSocket)
const clients = new Map<string, WebSocket>();

export const initializeWebSocket = (server: http.Server) => {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws: WebSocket) => {
    console.log('🚀 A new client connected!');
    let userId: string | null = null;

    ws.on('message', async (message: string) => {
      try {
        const parsedMessage = JSON.parse(message);

        //  1: Handle Authentication on the first message ---
        if (parsedMessage.type === 'auth' && parsedMessage.token) {
          if (userId) { // Already authenticated
            return;
          }
          try {
            const decoded = jwt.verify(
              parsedMessage.token,
              process.env.JWT_SECRET as string
            ) as { id: string };

            userId = decoded.id;
            clients.set(userId, ws);
            console.log(`User ${userId} authenticated and connected.`);
            ws.send(JSON.stringify({ type: 'auth_success', message: 'Authentication successful' }));
          } catch (error) {
            console.log('Authentication failed');
            ws.send(JSON.stringify({ type: 'auth_error', message: 'Invalid token' }));
            ws.close();
          }
          return; // Stop processing after auth message
        }

        // 2: Handle incoming chat messages (only if authenticated) ---
        if (!userId) {
          ws.send(JSON.stringify({ type: 'error', message: 'Not authenticated' }));
          return;
        }

        if (parsedMessage.type === 'message' && parsedMessage.receiverId && parsedMessage.content) {
          console.log('✅ Message type recognized. Attempting to save to DB...');
          const { receiverId, content } = parsedMessage;
          // Save message to database
          const dbMessage = await prisma.message.create({
            data: { content, senderId: userId, receiverId: receiverId },
          });
          console.log('✅ Message saved to DB with ID:', dbMessage.id);

          // Invalidate the Redis cache for this conversation
          const sortedUserIds = [userId, receiverId].sort();
          const cacheKey = `chat:${sortedUserIds[0]}:${sortedUserIds[1]}`;
          await redis.del(cacheKey);
          console.log(`CACHE INVALIDATED for key: ${cacheKey}`);

          // forward message to receiver if they are online.
          const receiverSocket = clients.get(receiverId);
          if (receiverSocket) {
            receiverSocket.send(
              JSON.stringify({
                type: 'message',
                id: dbMessage.id,
                content: dbMessage.content,
                senderId: dbMessage.senderId,
                timestamp: dbMessage.timestamp,
              })
            );
          }
          ws.send(JSON.stringify({ type: 'message_sent_ack', messageId: dbMessage.id }));
        }
      } catch (error) {
        console.error('Failed to parse or handle message:', error);
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
      }
    });

    ws.on('close', () => {
      if (userId) {
        clients.delete(userId);
        console.log(`User ${userId} disconnected.`);
      } else {
        console.log('An unauthenticated user disconnected.');
      }
    });
  });

  console.log('WebSocket server initialized.');
};
