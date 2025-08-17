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

// NEW: cache settings
const HISTORY_CACHE_LIMIT = 100;       // keep latest 100 per viewer
const CACHE_TTL_SECONDS = 3600;        // 1 hour TTL

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

// NEW: helper to build consistent viewer-scoped cache keys
function viewerCacheKey(a: string, b: string, viewerId: string) {
  const [x, y] = [a, b].sort();
  return `chat:${x}:${y}:viewer:${viewerId}`;
}

// NEW: safe JSON.parse
function safeParse<T>(s: string | null): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

// NEW: prepend a single item to a viewer’s cached array (bounded + TTL)
async function prependToViewerCache(
  key: string,
  item: { id: string; senderId: string; timestamp: string; content: HybridEncrypted }
) {
  try {
    const existing = await redis.get(key);
    const arr = safeParse<typeof item[]>(existing) ?? [];
    arr.unshift(item);
    if (arr.length > HISTORY_CACHE_LIMIT) arr.length = HISTORY_CACHE_LIMIT;
    await redis.set(key, JSON.stringify(arr), 'EX', CACHE_TTL_SECONDS);
  } catch (e) {
    // Cache failures should never break messaging; log and continue
    console.error('Redis cache update failed:', (e as Error).message);
  }
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

          // --- NEW: Update viewer-scoped Redis caches (no longer just invalidate) ---
          const tsISO = dbMessage.timestamp.toISOString();

          const senderView = {
            id: dbMessage.id,
            senderId: dbMessage.senderId,
            content: dbMessage.contentForSender as HybridEncrypted,
            timestamp: tsISO,
          };
          const receiverView = {
            id: dbMessage.id,
            senderId: dbMessage.senderId,
            content: dbMessage.contentForReceiver as HybridEncrypted,
            timestamp: tsISO,
          };

          const senderKey = viewerCacheKey(userId, receiverId, userId);
          const receiverKey = viewerCacheKey(userId, receiverId, receiverId);

          // Try to prepend to existing caches; if key doesn't exist, this will create it.
          await Promise.all([
            prependToViewerCache(senderKey, senderView),
            prependToViewerCache(receiverKey, receiverView),
          ]);

          // Realtime to receiver -> their decryptable copy
          const receiverSocket = clients.get(receiverId);
          if (receiverSocket) {
            const out: OutgoingWS = {
              type: 'message',
              id: dbMessage.id,
              senderId: dbMessage.senderId,
              content: receiverView.content,
              timestamp: tsISO,
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
              content: senderView.content,
              timestamp: tsISO,
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
