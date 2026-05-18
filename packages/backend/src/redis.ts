import Redis from "ioredis";

import { config } from "./config";

export const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: 1,
  lazyConnect: true,
  retryStrategy: (times) => Math.min(times * 500, 5000),
  commandTimeout: 300
});

export const redisSubscriber = new Redis(config.redisUrl, {
  maxRetriesPerRequest: null,
  lazyConnect: true,
  retryStrategy: (times) => Math.min(times * 500, 5000)
});

redis.on("error", (err) => {
  if ((err as NodeJS.ErrnoException).code !== "ECONNREFUSED") {
    console.error("[redis] error:", err.message);
  }
});

redisSubscriber.on("error", (err) => {
  if ((err as NodeJS.ErrnoException).code !== "ECONNREFUSED") {
    console.error("[redis-sub] error:", err.message);
  }
});
