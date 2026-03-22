import { Ratelimit } from "@upstash/ratelimit";
import { redis } from "./redis";

export const apiRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(100, "60 s"),
  prefix: "ratelimit:api",
  analytics: true,
});

export const authRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, "60 s"),
  prefix: "ratelimit:auth",
  analytics: true,
});
