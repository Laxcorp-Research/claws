/**
 * Lifecycle P3 — stale-destroy refusal helpers.
 * Auto-hibernate MUST NOT destroy when sync fails or snapshot is too old.
 */

export const DEFAULT_STALE_DESTROY_MAX_AGE_MIN = 30

export function staleDestroyMaxAgeMs(): number {
  const raw = process.env.STALE_DESTROY_MAX_AGE_MIN
  const parsed = raw !== undefined ? Number.parseInt(raw, 10) : DEFAULT_STALE_DESTROY_MAX_AGE_MIN
  const minutes =
    Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_STALE_DESTROY_MAX_AGE_MIN
  return minutes * 60 * 1000
}

export function isRuntimeStateStale(
  runtimeStateUpdatedAt: Date | null | undefined,
  nowMs: number = Date.now(),
  maxAgeMs: number = staleDestroyMaxAgeMs(),
): boolean {
  if (!runtimeStateUpdatedAt) return true
  return nowMs - runtimeStateUpdatedAt.getTime() > maxAgeMs
}

export const HIBERNATION_REFUSED_ACTION = "hibernation refused: state not safely synced"
