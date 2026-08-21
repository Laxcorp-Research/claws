/**
 * Shared hibernation candidate predicates - cron route and agent candidates
 * API MUST stay in lockstep (parity invariant).
 *
 * Wake eligibility (lead / past-due) is NOT expressed in Prisma `where` (lead
 * depends on per-row avgWakeDurationMs). Both callers MUST post-filter with
 * `isWakeEligible` from wake-geometry - never inline the old 2m clamp or `gt: now`.
 *
 * PR-C #10: `Workspace.alwaysOn` opts a claw out of the sweep entirely - both
 * SLEEP predicates (runningIdleWhere / warmIdleWhere) filter `alwaysOn: false`.
 * wakeHibernatedWhere is untouched: an alwaysOn claw should never reach
 * HIBERNATED in the first place, and even if it somehow did, waking it is the
 * safe direction.
 */

export const RUNNING_IDLE_MS = 10 * 60 * 1000
export const CHANNEL_IDLE_MS = 24 * 60 * 60 * 1000

/** Default: never hibernate a claw whose nextHeartbeatAt is within 15m. */
export const DEFAULT_HEARTBEAT_IMMINENT_EXEMPT_MS = 15 * 60 * 1000

/** @deprecated alias - use HEARTBEAT_IMMINENT_EXEMPT_MS / resolveImminentExemptMs() */
export const HEARTBEAT_FUTURE_MS = DEFAULT_HEARTBEAT_IMMINENT_EXEMPT_MS

/**
 * Env-tunable imminent-beat exemption (ms). Floor holds env-less at 15m.
 * MUTATION: restoring a 0 default → imminent claws match hibernate predicates.
 */
export function resolveImminentExemptMs(): number {
  const raw = process.env.HEARTBEAT_IMMINENT_EXEMPT_MS
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return DEFAULT_HEARTBEAT_IMMINENT_EXEMPT_MS
  }
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_HEARTBEAT_IMMINENT_EXEMPT_MS
  return Math.floor(n)
}

function imminentExemptCutoff(now: Date): Date {
  return new Date(now.getTime() + resolveImminentExemptMs())
}

/**
 * SLEEP-ONLY nextHeartbeatAt guard: null OR strictly beyond the imminent window.
 * Claws with a hint in (now, now+exempt] - or past-due - do not match *hibernate*.
 *
 * MUST NOT be applied to wakeHibernatedWhere - sleep and wake are opposite intents:
 * imminent / past-due claws are exactly who wake must consider.
 * MUTATION: spreading this into wakeHibernatedWhere → wake-window tests fail.
 */
function nextHeartbeatNotImminent(now: Date) {
  const exemptUntil = imminentExemptCutoff(now)
  return {
    OR: [
      { nextHeartbeatAt: null },
      { nextHeartbeatAt: { gt: exemptUntil } },
    ],
  }
}

/**
 * Prisma `where` for RUNNING idle (no channels, 10m lastActiveAt).
 * MUTATION: dropping `workspace: { alwaysOn: false }` → alwaysOn claws hibernate.
 */
export function runningIdleWhere(now: Date) {
  const idleCutoff = new Date(now.getTime() - RUNNING_IDLE_MS)
  return {
    containerPhase: "RUNNING" as const,
    hasActiveChannels: false,
    lastActiveAt: { lt: idleCutoff },
    workspace: { alwaysOn: false },
    ...nextHeartbeatNotImminent(now),
  }
}

/**
 * Prisma `where` for WARM channel-idle (P1.1).
 *
 * Matches when either:
 *   (A) lastChannelMessageAt is NON-NULL and older than 24h, OR
 *   (B) lastChannelMessageAt is null AND channelsConnectedAt older than 24h
 *       (never-messaged but channel configured long enough - safe with P5
 *       wake-on-channel).
 *
 * Imminent-beat exemption: never sleep a claw about to keep an appointment
 * (kills the 08:08 class when the next hint is still within the window).
 *
 * MUTATION: null stamp + fresh channelsConnectedAt must NOT match.
 * MUTATION: drop nextHeartbeatNotImminent → imminent claws hibernate.
 * MUTATION: dropping `workspace: { alwaysOn: false }` → alwaysOn claws hibernate.
 */
export function warmIdleWhere(now: Date) {
  const channelIdleCutoff = new Date(now.getTime() - CHANNEL_IDLE_MS)
  return {
    containerPhase: "WARM" as const,
    workspace: { alwaysOn: false },
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
      nextHeartbeatNotImminent(now),
    ],
  }
}

/**
 * Prisma `where` for HIBERNATED claws that may be wake-eligible.
 * Post-filter every row with `isWakeEligible` (wake-geometry).
 *
 * Intentionally has NO imminent-beat exemption - wake must INCLUDE imminent
 * and past-due claws (opposite of runningIdle/warmIdle sleep predicates).
 *
 * MUTATION: restoring `nextHeartbeatAt: { gt: now }` here → past-due never wakes.
 * MUTATION: adding nextHeartbeatNotImminent / gt:exemptUntil here → wake-window fails.
 */
export function wakeHibernatedWhere() {
  return {
    containerPhase: "HIBERNATED" as const,
    nextHeartbeatAt: { not: null },
  }
}
