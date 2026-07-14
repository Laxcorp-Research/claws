/**
 * Pure detector for the PR-3 near-cap AlertStack banner.
 *
 * Container (-8) emits ERROR + metadata.kind:"state_sync_near_cap" at ≥80%.
 * Banner stays active until a subsequent sync reports compressed size <70% (re-arm).
 */
import { NEAR_CAP_REARM_BYTES } from "@/lib/openclaw/state-sync-limits"

export type NearCapWarning = {
  timestamp: Date
}

export type NearCapSnapshot = {
  updatedAt: Date
  compressedBytes: number
}

/**
 * Returns true when the newest near-cap warning is still unresolved.
 * MUTATION-anchored: dropping the re-arm check would leave the banner stuck forever;
 * dropping the warning check would never show it.
 */
export function decideNearCapAlert(input: {
  latestWarning: NearCapWarning | null
  latestSnapshot: NearCapSnapshot | null
}): boolean {
  // NEAR_CAP_DETECT_ASSERT: warning_required
  if (!input.latestWarning) return false

  const snap = input.latestSnapshot
  if (!snap) return true

  // Recovery: a sync AFTER the warning that landed below re-arm clears the banner.
  // NEAR_CAP_DETECT_ASSERT: rearm_clears_banner
  if (
    snap.updatedAt.getTime() > input.latestWarning.timestamp.getTime() &&
    snap.compressedBytes < NEAR_CAP_REARM_BYTES
  ) {
    return false
  }

  return true
}

/** metadata.kind value written by container/state-sync.mjs maybeEmitNearCapWarning. */
export const NEAR_CAP_METADATA_KIND = "state_sync_near_cap"

/** Substring match against ActivityLog.metadata (stored as JSON text). */
export const NEAR_CAP_METADATA_CONTAINS = `"kind":"${NEAR_CAP_METADATA_KIND}"`
