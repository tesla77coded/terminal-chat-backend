/// <reference path="../types/express/index.d.ts" />

import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import prisma from '../config/prisma';
import redis from '../config/redis';

type HybridEncrypted = {
  iv: string;
  encryptedKey: string;
  encryptedMessage: string;
  authTag: string;
};

type IncomingWS =
  | { type: 'auth'; token: string }
  | {
    type: 'message';
    receiverId: string;
    contentForSender: HybridEncrypted | string;
    contentForReceiver: HybridEncrypted | string;
  };

type OutgoingWS =
  | { type: 'auth_success'; message: string }
  | { type: 'auth_error'; message: string }
  | {
    type: 'message';
    id: string;
    senderId: string;
    content: HybridEncrypted;
    timestamp: string;
  }
  | { type: 'message_sent_ack'; messageId: string }
  | { type: 'error'; message: string };

const clients = new Map<string, WebSocket>();

function isHybridEncrypted(obj: any): obj is HybridEncrypted {
  return (
    obj &&
    typeof obj === 'object' &&
    typeof obj.iv === 'string' &&
    typeof obj.encryptedKey === 'string' &&
    typeof obj.encryptedMessage === 'string' &&
    typeof obj.authTag === 'string'
  );
}

export const initializeWebSocket = (server: http.Server) => {
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws: WebSocket) => {
    let userId: string | null = null;

    ws.on('message', async (raw: string) => {
      try {
        const parsed: IncomingWS = JSON.parse(raw);

        // 1) AUTH --------------------------------------------------------------
        if (parsed.type === 'auth') {
          if (userId) return; // already authed
          try {
            const decoded = jwt.verify(
              parsed.token,
              process.env.JWT_SECRET as string
            ) as { id: string };

            userId = decoded.id;
            clients.set(userId, ws);
            const msg: OutgoingWS = {
              type: 'auth_success',
              message: 'Authentication successful',
            };
            ws.send(JSON.stringify(msg));
          } catch {
            const msg: OutgoingWS = {
              type: 'auth_error',
              message: 'Invalid token',
            };
            ws.send(JSON.stringify(msg));
            ws.close();
          }
          return;
        }

        // 2) GUARD: must be authed for anything else ---------------------------
        if (!userId) {
          const msg: OutgoingWS = {
            type: 'error',
            message: 'Not authenticated',
          };
          ws.send(JSON.stringify(msg));
          return;
        }

        // 3) INCOMING CHAT MESSAGE --------------------------------------------
        if (parsed.type === 'message') {
          const { receiverId } = parsed;

          // Normalize & validate blobs (strings -> objects)
          const s = typeof parsed.contentForSender === 'string'
            ? JSON.parse(parsed.contentForSender)
            : parsed.contentForSender;
          const r = typeof parsed.contentForReceiver === 'string'
            ? JSON.parse(parsed.contentForReceiver)
            : parsed.contentForReceiver;

          if (!isHybridEncrypted(s) || !isHybridEncrypted(r)) {
            throw new Error('Invalid content format');
          }

          // Persist both versions
          const dbMessage = await prisma.message.create({
            data: {
              senderId: userId,
              receiverId,
              contentForSender: s,
              contentForReceiver: r,
              timestamp: new Date(),
            },
          });

          // Invalidate BOTH viewers' caches (viewer-scoped key, see controller fix below)
          const ids = [userId, receiverId].sort();
          const base = `chat:${ids[0]}:${ids[1]}`;
          await redis.del(`${base}:viewer:${userId}`);
          await redis.del(`${base}:viewer:${receiverId}`);

          // Realtime to receiver -> their decryptable copy
          const receiverSocket = clients.get(receiverId);
          if (receiverSocket) {
            const out: OutgoingWS = {
              type: 'message',
              id: dbMessage.id,
              senderId: dbMessage.senderId,
              content: dbMessage.contentForReceiver as HybridEncrypted,
              timestamp: dbMessage.timestamp.toISOString(),
            };
            receiverSocket.send(JSON.stringify(out));
          }

          // Optional: notify sender too (UI currently ignores since senderId!==contact.id)
          const senderSocket = clients.get(userId);
          if (senderSocket) {
            const out: OutgoingWS = {
              type: 'message',
              id: dbMessage.id,
              senderId: dbMessage.senderId,
              content: dbMessage.contentForSender as HybridEncrypted,
              timestamp: dbMessage.timestamp.toISOString(),
            };
            senderSocket.send(JSON.stringify(out));
          }

          // Ack back to sender (kept for UX/debug)
          const ack: OutgoingWS = { type: 'message_sent_ack', messageId: dbMessage.id };
          ws.send(JSON.stringify(ack));
        }
      } catch (err) {
        console.error('WS error:', err);
        const msg: OutgoingWS = { type: 'error', message: 'Invalid message format' };
        ws.send(JSON.stringify(msg));
      }
    });

    ws.on('close', () => {
      if (userId) clients.delete(userId);
    });
  });

  console.log('WebSocket server initialized.');
};
