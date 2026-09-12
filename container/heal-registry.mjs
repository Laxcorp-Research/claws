/**
 * Overlay heal registry - which boot/runtime repairs count against a soak.
 *
 * thinking_signature_heal is a live defect class (counts).
 * runtime_volume_migration is a one-shot jsonl/cron-JSON → sqlite conversion
 * on first 9.4 wake of a legacy volume (does not count against "zero heals").
 */

export const THINKING_SIGNATURE_HEAL_EVENT_KIND = "thinking_signature_heal"
export const RUNTIME_VOLUME_MIGRATION_EVENT_KIND = "runtime_volume_migration"
export const RUNTIME_VOLUME_MIGRATION_REGISTRY = "runtime-volume-migration"

/** @type {Record<string, { soakCounts: boolean, registry?: string }>} */
export const HEAL_REGISTRY = {
  [THINKING_SIGNATURE_HEAL_EVENT_KIND]: { soakCounts: true },
  [RUNTIME_VOLUME_MIGRATION_EVENT_KIND]: {
    soakCounts: false,
    registry: RUNTIME_VOLUME_MIGRATION_REGISTRY,
  },
}

export function healCountsAgainstSoak(eventKind) {
  const row = HEAL_REGISTRY[eventKind]
  return row ? row.soakCounts === true : true
}
