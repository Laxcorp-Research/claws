/**
 * Size policy for runtime-state snapshots (Blob token / finalize).
 * Must stay in lockstep with container/state-sync.mjs.
 *
 * Soft target: overlay trims logs/caches/non-session bulk and ledgers a
 * WARNING. Hard cap: blob-token / finalize reject above this. A 9.4 volume
 * with history (~54MB observed) must persist; never silent 400.
 */
export const SOFT_TARGET_COMPRESSED_BYTES = 50 * 1024 * 1024

/** Absolute ceiling for a snapshot we will persist via Blob finalize. */
export const ABSOLUTE_MAX_COMPRESSED_BYTES = 80 * 1024 * 1024

/** Near-cap WARNING arm threshold (≥80% of absolute max). Lockstep with container/state-sync.mjs. */
export const NEAR_CAP_WARN_BYTES = Math.floor(ABSOLUTE_MAX_COMPRESSED_BYTES * 0.8)

/** Near-cap re-arm threshold (<70% of absolute max). Banner auto-resolves when a later sync is below this. */
export const NEAR_CAP_REARM_BYTES = Math.floor(ABSOLUTE_MAX_COMPRESSED_BYTES * 0.7)
