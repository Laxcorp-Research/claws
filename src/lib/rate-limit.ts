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

// PR-9/A-vercel: per-workspace chat sends. Keyed `${userId}:${workspaceId}`
// (checked INSIDE the chat route after ownership — the middleware can't
// know the workspace cheaply). Each accepted send triggers an LLM turn on
// the user's key/credits, so this is tighter than the global API limit.
// Fail-open like the others (route catches Redis errors).
export const chatRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(20, "60 s"),
  prefix: "ratelimit:chat",
  analytics: true,
});
