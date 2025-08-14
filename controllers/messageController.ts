///  <reference path="../types/express/index.d.ts" />
import { Request, Response } from 'express';
import prisma from '../config/prisma';
import redis from '../config/redis';

// @desc          Get chat history with another user 
// @route         GET /api/messages/:otherUserId
// @access        Private
export const getMessages = async (req: Request, res: Response) => {
  try {
    const currentUserId = req.user!.id;
    const otherUserId = req.params.otherUserId;

    await prisma.message.updateMany({
      where: {
        senderId: otherUserId,
        receiverId: currentUserId,
        read: false,
      },
      data: {
        read: true,
      },
    });

    const sortedUserIds = [currentUserId, otherUserId].sort();
    const cacheKey = `chat:${sortedUserIds[0]}:${sortedUserIds[1]}`;
    const cachedMessages = await redis.get(cacheKey);

    if (cachedMessages) {
      console.log(`CACHE HIT for key: ${cacheKey}`);
      return res.json(JSON.parse(cachedMessages));
    }
    // --------------------------------

    console.log(`CACHE MISS for key: ${cacheKey}. Fetching from DB.`);
    const messages = await prisma.message.findMany({
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

    if (messages.length > 0) {
      await redis.set(cacheKey, JSON.stringify(messages), 'EX', 3600);
    }

    res.json(messages);

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error.' });
  }
};


// @desc      Get a list of users the current user has chatted with
// @route     GET /api/messages/chats
// @access    Private
export const getChats = async (req: Request, res: Response) => {
  try {
    const currentUserId = req.user!.id;

    // find all the messages user has sent or received
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

    // set of unique IDs of the other users in conversations
    const chatPartnerIds = new Set<string>();
    messages.forEach(msg => {
      if (msg.senderId === currentUserId) {
        chatPartnerIds.add(msg.receiverId);
      } else {
        chatPartnerIds.add(msg.senderId);
      }
    });

    // fetching user details for chatPartnerIds
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


    const chatsWithDetails = await Promise.all(
      chatPartners.map(async (partner) => {
        const unreadCount = await prisma.message.count({
          where: { senderId: partner.id, receiverId: currentUserId, read: false },
        });

        // --- NEW: Get the timestamp of the very last message ---
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
          lastMessageTimestamp: lastMessage?.timestamp || new Date(0) // Return a default old date if no message exists
        };
      })
    );

    res.json(chatsWithDetails);

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error.' });
  };
};

