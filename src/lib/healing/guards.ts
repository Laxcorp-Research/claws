export const AUTO_REDEPLOY_IDLE_MS = 5 * 60 * 1000
export const AUTO_REDEPLOY_BACKOFF_MS = [0, 15 * 60 * 1000, 60 * 60 * 1000] as const
export const AUTO_REDEPLOY_CAP_24H = 3

export const AUTO_REDEPLOY_GUARD_NAMES = [
  "sync-succeeded",
  "idle-5min",
  "backoff",
  "cap",
] as const

export type AutoRedeployGuardName = (typeof AUTO_REDEPLOY_GUARD_NAMES)[number]

export const AUTO_REDEPLOY_CONDITIONS = [
  "bad-token",
  "plugin-not-loaded",
  "mcp-session-dead",
  "thinking-signature-poison",
  "probe-degraded",
] as const

export const CRASH_RESTART_BACKOFF_MS = [30_000, 2 * 60 * 1000, 10 * 60 * 1000] as const
export const CRASH_RESTART_CAP_PER_HOUR = 5

export const CRASH_RESTART_GUARD_NAMES = [
  "sync-if-possible",
  "backoff",
  "cap",
] as const

export const SILENT_WAKE_BACKOFF_MS = [0, 15 * 60 * 1000, 60 * 60 * 1000] as const
export const SILENT_WAKE_CAP_24H = 3

export const SILENT_WAKE_GUARD_NAMES = ["entitlement", "backoff", "cap"] as const

export type SilentWakeGuardName = (typeof SILENT_WAKE_GUARD_NAMES)[number]

export type CrashRestartGuardName = (typeof CRASH_RESTART_GUARD_NAMES)[number]

export const MAX_TRANSIENT_DEPLOY_ATTEMPTS = 2

export type GuardDecision<G extends string> = {
  allowed: boolean
  blockedBy: G | null
  escalateOwner: boolean
}

export function evaluateAutoRedeployGuards(input: {
  syncSucceeded: boolean
  idleMs: number
  attemptsInWindow: number
  lastAttemptAt: Date | null
  now: Date
}): GuardDecision<AutoRedeployGuardName> {
  if (!input.syncSucceeded) {
    return { allowed: false, blockedBy: "sync-succeeded", escalateOwner: false }
  }
  if (input.idleMs < AUTO_REDEPLOY_IDLE_MS) {
    return { allowed: false, blockedBy: "idle-5min", escalateOwner: false }
  }
  if (input.attemptsInWindow >= AUTO_REDEPLOY_CAP_24H) {
    return { allowed: false, blockedBy: "cap", escalateOwner: true }
  }
  const backoffIdx = Math.min(input.attemptsInWindow, AUTO_REDEPLOY_BACKOFF_MS.length - 1)
  const backoffMs = AUTO_REDEPLOY_BACKOFF_MS[backoffIdx]
  if (
    input.lastAttemptAt &&
    input.now.getTime() - input.lastAttemptAt.getTime() < backoffMs
  ) {
    return { allowed: false, blockedBy: "backoff", escalateOwner: false }
  }
  return { allowed: true, blockedBy: null, escalateOwner: false }
}

/**
 * Crash restart: try sync (never a hard block), then backoff 30s/2m/10m,
 * cap 5/h → owner.
 */
export function evaluateCrashRestartGuards(input: {
  attemptsInHour: number
  lastAttemptAt: Date | null
  now: Date
}): GuardDecision<CrashRestartGuardName> {
  // sync-if-possible is checked by the executor; it never blocks the plan.
  if (input.attemptsInHour >= CRASH_RESTART_CAP_PER_HOUR) {
    return { allowed: false, blockedBy: "cap", escalateOwner: true }
  }
  const backoffIdx = Math.min(input.attemptsInHour, CRASH_RESTART_BACKOFF_MS.length - 1)
  const backoffMs = CRASH_RESTART_BACKOFF_MS[backoffIdx]
  if (
    input.lastAttemptAt &&
    input.now.getTime() - input.lastAttemptAt.getTime() < backoffMs
  ) {
    return { allowed: false, blockedBy: "backoff", escalateOwner: false }
  }
  return { allowed: true, blockedBy: null, escalateOwner: false }
}

/**
 * Silent-wake: retry scheduled wake with backoff, then cap → owner.
 * Entitlement is checked by the executor (customer nudge, no wake).
 */
export function evaluateSilentWakeGuards(input: {
  attemptsInWindow: number
  lastAttemptAt: Date | null
  now: Date
}): GuardDecision<SilentWakeGuardName> {
  if (input.attemptsInWindow >= SILENT_WAKE_CAP_24H) {
    return { allowed: false, blockedBy: "cap", escalateOwner: true }
  }
  const backoffIdx = Math.min(input.attemptsInWindow, SILENT_WAKE_BACKOFF_MS.length - 1)
  const backoffMs = SILENT_WAKE_BACKOFF_MS[backoffIdx]
  if (
    input.lastAttemptAt &&
    input.now.getTime() - input.lastAttemptAt.getTime() < backoffMs
  ) {
    return { allowed: false, blockedBy: "backoff", escalateOwner: false }
  }
  return { allowed: true, blockedBy: null, escalateOwner: false }
}

const TRANSIENT_MARKERS = [
  "econnreset",
  "etimedout",
  "eai_again",
  "socket hang up",
  "timeout",
  "temporar",
  "try again",
  "503",
  "502",
  "429",
  "rate limit",
  "unavailable",
]

const NON_TRANSIENT_MARKERS = [
  "notauthorized",
  "unauthorized",
  "forbidden",
  "provider_auth_missing",
  "provisioning queued",
  "forbidcreate",
  "already exists",
  "invalid",
  "validation",
]

export function isTransientDeployError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  if (NON_TRANSIENT_MARKERS.some((m) => msg.includes(m))) return false
  return TRANSIENT_MARKERS.some((m) => msg.includes(m))
}

export async function withTransientDeployRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt < MAX_TRANSIENT_DEPLOY_ATTEMPTS; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const lastTry = attempt === MAX_TRANSIENT_DEPLOY_ATTEMPTS - 1
      if (!isTransientDeployError(err) || lastTry) throw err
    }
  }
  throw lastErr
}
