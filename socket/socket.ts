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

        // 1: Handle Authentication on the first message ---
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

        if (parsedMessage.type === 'message' && parsedMessage.receiverId && parsedMessage.contentForSender && parsedMessage.contentForReceiver) {
          const { receiverId, contentForSender, contentForReceiver } = parsedMessage;

          // Parse content fields to ensure they are objects, not strings
          const contentForSenderParsed = typeof contentForSender === 'string' ? JSON.parse(contentForSender) : contentForSender;
          const contentForReceiverParsed = typeof contentForReceiver === 'string' ? JSON.parse(contentForReceiver) : contentForReceiver;

          // Validate content structure
          if (!contentForSenderParsed.iv || !contentForSenderParsed.encryptedKey || !contentForSenderParsed.encryptedMessage || !contentForSenderParsed.authTag ||
            !contentForReceiverParsed.iv || !contentForReceiverParsed.encryptedKey || !contentForReceiverParsed.encryptedMessage || !contentForReceiverParsed.authTag) {
            throw new Error('Invalid content format');
          }

          // 1. Save both encrypted versions to the database
          const dbMessage = await prisma.message.create({
            data: {
              senderId: userId,
              receiverId: receiverId,
              contentForSender: contentForSenderParsed,
              contentForReceiver: contentForReceiverParsed,
              timestamp: new Date(),
            },
          });

          const sortedUserIds = [userId, receiverId].sort();
          const cacheKeyUser1 = `chat:${sortedUserIds[0]}:${sortedUserIds[1]}:user:${userId}`;
          const cacheKeyUser2 = `chat:${sortedUserIds[0]}:${sortedUserIds[1]}:user:${receiverId}`;
          await redis.del(cacheKeyUser1);
          await redis.del(cacheKeyUser2);
          console.log(`CACHE INVALIDATED for keys: ${cacheKeyUser1}, ${cacheKeyUser2}`);

          // 2. Forward the correct payload to the receiver
          const receiverSocket = clients.get(receiverId);
          if (receiverSocket) {
            receiverSocket.send(
              JSON.stringify({
                type: 'message',
                id: dbMessage.id,
                senderId: dbMessage.senderId,
                content: dbMessage.contentForReceiver,
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
