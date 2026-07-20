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
 * Prisma `where` for WARM channel-idle (P1.1).
 *
 * Matches when either:
 *   (A) lastChannelMessageAt is NON-NULL and older than 24h, OR
 *   (B) lastChannelMessageAt is null AND channelsConnectedAt older than 24h
 *       (never-messaged but channel configured long enough — safe with P5
 *       wake-on-channel).
 *
 * MUTATION: null stamp + fresh channelsConnectedAt must NOT match.
 */
export function warmIdleWhere(now: Date) {
  const channelIdleCutoff = new Date(now.getTime() - CHANNEL_IDLE_MS)
  const futureWindow = new Date(now.getTime() + HEARTBEAT_FUTURE_MS)
  return {
    containerPhase: "WARM" as const,
    AND: [
      {
        OR: [
          { lastChannelMessageAt: { lt: channelIdleCutoff } },
          {
            AND: [
              { lastChannelMessageAt: null },
              { channelsConnectedAt: { lt: channelIdleCutoff } },
            ],
          },
        ],
      },
      {
        OR: [{ nextHeartbeatAt: null }, { nextHeartbeatAt: { gt: futureWindow } }],
      },
    ],
  }
}
