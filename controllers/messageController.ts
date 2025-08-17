///  <reference path="../types/express/index.d.ts" />
import { Request, Response } from 'express';
import prisma from '../config/prisma';
import redis from '../config/redis';

const CACHE_TTL_SECONDS = parseInt(process.env.MESSAGE_CACHE_TTL ?? '3600', 10);

// @desc          Get chat history with another user 
// @route         GET /api/messages/:otherUserId
// @access        Private
export const getMessages = async (req: Request, res: Response) => {
  const routeStart = Date.now();

  try {
    const currentUserId = req.user!.id;
    const otherUserId = req.params.otherUserId;

    console.log(
      `[Messages] user=${currentUserId} peer=${otherUserId} :: START (GET /api/messages/:otherUserId)`
    );

    // --- MARK READ (fire-and-forget) ---------------------------------------
    // Start update but do NOT await it — log result when it completes.
    const markStart = Date.now();
    prisma.message.updateMany({
      where: {
        senderId: otherUserId,
        receiverId: currentUserId,
        read: false,
      },
      data: {
        read: true,
      },
    })
      .then(result => {
        console.log(
          `[Messages] Mark read -> count=${(result as any).count} (${Date.now() - markStart}ms) (async)`
        );
      })
      .catch(err => {
        console.error('[Messages] Mark read (async) failed:', err);
      });

    // viewer-scoped cache key (so each side gets its decryptable copy)
    const sortedUserIds = [currentUserId, otherUserId].sort();
    const cacheKey = `chat:${sortedUserIds[0]}:${sortedUserIds[1]}:viewer:${currentUserId}`;

    // ----- Redis: GET --------------------------------------------------------
    const rGetStart = Date.now();
    const cachedMessages = await redis.get(cacheKey);
    const rGetMs = Date.now() - rGetStart;

    if (cachedMessages) {
      const sizeBytes =
        typeof cachedMessages === 'string'
          ? Buffer.byteLength(cachedMessages, 'utf8')
          : 0;

      console.log(
        `[Redis] HIT key=${cacheKey} getTime=${rGetMs}ms size=${sizeBytes}B`
      );

      try {
        const parsed = JSON.parse(cachedMessages as string);
        res.setHeader('X-Cache', 'HIT');
        console.log(
          `[Messages] RETURN (HIT) items=${Array.isArray(parsed) ? parsed.length : 'n/a'} totalTime=${Date.now() - routeStart}ms`
        );
        return res.json(parsed);
      } catch (e) {
        console.error(
          `[Redis] Parse error for key=${cacheKey}. Deleting corrupt cache.`,
          e
        );
        await redis.del(cacheKey);
        // fall through to DB fetch
      }
    } else {
      console.log(`[Redis] MISS key=${cacheKey} getTime=${rGetMs}ms`);
    }

    // ----- DB: fetch ---------------------------------------------------------
    const dbStart = Date.now();
    const messagesFromDb = await prisma.message.findMany({
      where: {
        OR: [
          { senderId: currentUserId, receiverId: otherUserId },
          { senderId: otherUserId, receiverId: currentUserId },
        ],
      },
      orderBy: {
        timestamp: 'desc',
      },
    });
    const dbMs = Date.now() - dbStart;
    console.log(
      `[DB] Fetched messages count=${messagesFromDb.length} time=${dbMs}ms`
    );

    // Map to viewer's decryptable content
    const mapStart = Date.now();
    const messagesForClient = messagesFromDb.map(msg => {
      const content =
        msg.senderId === currentUserId
          ? msg.contentForSender
          : msg.contentForReceiver;

      return {
        id: msg.id,
        senderId: msg.senderId,
        timestamp: msg.timestamp,
        content,
      };
    });
    console.log(
      `[Messages] Map->client count=${messagesForClient.length} mapTime=${Date.now() - mapStart}ms`
    );

    // ----- Redis: SET (only if we have items) --------------------------------
    if (messagesForClient.length > 0) {
      const payload = JSON.stringify(messagesForClient);
      const rSetStart = Date.now();
      const result = await redis.set(cacheKey, payload, 'EX', CACHE_TTL_SECONDS);
      console.log(
        `[Redis] SET key=${cacheKey} ttl=${CACHE_TTL_SECONDS}s result=${result} setTime=${Date.now() - rSetStart}ms size=${Buffer.byteLength(
          payload,
          'utf8'
        )}B`
      );
    } else {
      console.log(`[Redis] SKIP SET (no messages) key=${cacheKey}`);
    }

    res.setHeader('X-Cache', 'MISS');
    console.log(
      `[Messages] RETURN (MISS) items=${messagesForClient.length} totalTime=${Date.now() - routeStart}ms`
    );
    res.json(messagesForClient);
  } catch (error) {
    console.error('[Messages] ERROR', error);
    res.status(500).json({ message: 'Server error.' });
  }
};


// @desc      Get a list of users the current user has chatted with
// @route     GET /api/messages/chats
// @access    Private
export const getChats = async (req: Request, res: Response) => {
  const start = Date.now();
  try {
    const currentUserId = req.user!.id;
    console.log(`[Chats] Fetch for user=${currentUserId}`);

    const cacheKey = `chats:viewer:${currentUserId}`;

    // Try Redis first
    const rGetStart = Date.now();
    const cached = await redis.get(cacheKey);
    const rGetMs = Date.now() - rGetStart;

    if (cached) {
      console.log(`[Redis] HIT key=${cacheKey} getTime=${rGetMs}ms size=${Buffer.byteLength(cached, 'utf8')}B`);
      try {
        const parsed = JSON.parse(cached as string);
        console.log(`[Chats] RETURN (HIT) items=${Array.isArray(parsed) ? parsed.length : 'n/a'} totalTime=${Date.now() - start}ms`);
        res.setHeader('X-Cache', 'HIT');
        return res.json(parsed);
      } catch (e) {
        console.error(`[Redis] Parse error for chats cache key=${cacheKey}. Deleting corrupt cache.`, e);
        await redis.del(cacheKey);
        // continue to DB fetch
      }
    } else {
      console.log(`[Redis] MISS key=${cacheKey} getTime=${rGetMs}ms`);
    }

    // Fetch from DB (existing logic)
    const msgsStart = Date.now();
    const messages = await prisma.message.findMany({
      where: {
        OR: [
          { senderId: currentUserId },
          { receiverId: currentUserId },
        ],
      },
      select: {
        senderId: true,
        receiverId: true,
      },
    });
    console.log(
      `[Chats] Baseline message scan count=${messages.length} time=${Date.now() - msgsStart}ms`
    );

    const chatPartnerIds = new Set<string>();
    messages.forEach(msg => {
      if (msg.senderId === currentUserId) {
        chatPartnerIds.add(msg.receiverId);
      } else {
        chatPartnerIds.add(msg.senderId);
      }
    });

    const usersStart = Date.now();
    const chatPartners = await prisma.user.findMany({
      where: {
        id: {
          in: [...chatPartnerIds],
        },
      },
      select: {
        id: true,
        username: true,
      },
    });
    console.log(
      `[Chats] Loaded partner profiles count=${chatPartners.length} time=${Date.now() - usersStart}ms`
    );

    const detailsStart = Date.now();
    const chatsWithDetails = await Promise.all(
      chatPartners.map(async (partner) => {
        const unreadCount = await prisma.message.count({
          where: { senderId: partner.id, receiverId: currentUserId, read: false },
        });

        // Get the timestamp of the very last message
        const lastMessage = await prisma.message.findFirst({
          where: {
            OR: [
              { senderId: currentUserId, receiverId: partner.id },
              { senderId: partner.id, receiverId: currentUserId },
            ]
          },
          orderBy: { timestamp: 'desc' }
        });

        return {
          ...partner,
          unreadCount,
          lastMessageTimestamp: lastMessage?.timestamp || new Date(0)
        };
      })
    );
    console.log(
      `[Chats] Details aggregated count=${chatsWithDetails.length} time=${Date.now() - detailsStart}ms totalTime=${Date.now() - start}ms`
    );

    // Cache chats for viewer
    try {
      const rSetStart = Date.now();
      const payload = JSON.stringify(chatsWithDetails);
      await redis.set(cacheKey, payload, 'EX', CACHE_TTL_SECONDS);
      console.log(`[Redis] SET key=${cacheKey} ttl=${CACHE_TTL_SECONDS}s setTime=${Date.now() - rSetStart}ms size=${Buffer.byteLength(payload, 'utf8')}B`);
    } catch (e) {
      console.error('[Redis] Failed to set chats cache', e);
    }

    res.json(chatsWithDetails);
  } catch (error) {
    console.error('[Chats] ERROR', error);
    res.status(500).json({ message: 'Server error.' });
  }
};
