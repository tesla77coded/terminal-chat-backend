import { Router, Request, Response } from "express";
import redis from "../config/redis";   // ✅ use your existing redis client

const router = Router();

/**
 * POST /internal/keepalive
 * Header: x-keepalive-token: <token>
 * Does: tiny Redis write with 1-hour TTL so Upstash registers activity.
 */
router.post("/keepalive", async (req: Request, res: Response) => {
  try {
    const token = req.headers["x-keepalive-token"];
    if (token !== process.env.CHAT_KEEPALIVE_TOKEN) {
      return res.status(401).send("unauthorized");
    }

    // One small write, auto-expires in 1 hour
    await redis.set(`keepalive:chat:${Date.now()}`, "1", "EX", 3600);

    res.status(200).send("ok");
  } catch (err) {
    console.error("keepalive error:", err);
    res.status(500).send("error");
  }
});

export default router;
