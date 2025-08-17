import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const redis = new Redis(process.env.REDIS_URL || "");

// Events
redis.on('connect', () => {
  console.log('✅ Connected to Redis!');
});

redis.on('error', (err) => {
  console.error('❌ Redis connection error ', err);
});

// Helper: generate a cache key for conversation scoped to a specific viewer
export const chatCacheKey = (userA: string, userB: string, viewerId: string) => {
  const ids = [userA, userB].sort(); // normalize ordering
  return `chat:${ids[0]}:${ids[1]}:viewer:${viewerId}`;
};

// TTL in seconds for cached messages (example: 60s)
export const MESSAGE_CACHE_TTL = 60;

export default redis;
