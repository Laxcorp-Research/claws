/**
 * Shared hibernation candidate predicates — cron route and agent candidates
 * API MUST stay in lockstep (parity invariant).
 */

export const RUNNING_IDLE_MS = 10 * 60 * 1000
export const CHANNEL_IDLE_MS = 24 * 60 * 60 * 1000
export const HEARTBEAT_FUTURE_MS = 15 * 60 * 1000

/** Prisma `where` for RUNNING idle (no channels, 10m lastActiveAt). */
export function runningIdleWhere(now: Date) {
  const idleCutoff = new Date(now.getTime() - RUNNING_IDLE_MS)
  const futureWindow = new Date(now.getTime() + HEARTBEAT_FUTURE_MS)
  return {
    containerPhase: "RUNNING" as const,
    hasActiveChannels: false,
    lastActiveAt: { lt: idleCutoff },
    OR: [{ nextHeartbeatAt: null }, { nextHeartbeatAt: { gt: futureWindow } }],
  }
}

/**
 * Prisma `where` for WARM channel-idle.
 * INVARIANT: lastChannelMessageAt must be NON-NULL and older than 24h.
 * Prisma `{ lt: cutoff }` excludes null — null WARM claws must NEVER match
 * (mutation: restore a null-match OR branch on the stamp → fail).
 */
export function warmIdleWhere(now: Date) {
  const channelIdleCutoff = new Date(now.getTime() - CHANNEL_IDLE_MS)
  const futureWindow = new Date(now.getTime() + HEARTBEAT_FUTURE_MS)
  return {
    containerPhase: "WARM" as const,
    lastChannelMessageAt: { lt: channelIdleCutoff },
    OR: [{ nextHeartbeatAt: null }, { nextHeartbeatAt: { gt: futureWindow } }],
  }
}
