// Shared ENV_RECONCILE_MODE gate for the container-env reconciliation effort.
//
// This is the SINGLE switch that turns healing on/off across BOTH the
// reconciliation cron and the event-triggered fast-path (contract §6/§8):
//   - detect_only (default): compare + log drift, NEVER heal.
//   - auto_heal:             heal on drift (cron) / on credential change (events).
//
// PR-8b note: unlike PR-8a/C's in-route resolveMode (which DOWNGRADED auto_heal
// to detect_only with a warning because healing wasn't implemented yet), this
// version honors auto_heal for real. PR-8b/B replaces the cron's local copy with
// an import of this module, removing the downgrade. The flag-flip
// `ENV_RECONCILE_MODE=auto_heal` on prod is the actual ship of AUTO-HEAL.

export type ReconcileMode = "detect_only" | "auto_heal"

/**
 * Resolve the reconciliation mode from the environment. Defaults to detect_only;
 * any value other than "detect_only" | "auto_heal" is a misconfiguration and
 * throws (fail closed — never silently guess at a healing posture).
 */
export function resolveMode(): ReconcileMode {
  const raw = process.env.ENV_RECONCILE_MODE
  if (raw === undefined || raw === "" || raw === "detect_only") return "detect_only"
  if (raw === "auto_heal") return "auto_heal"
  throw new Error(`Invalid ENV_RECONCILE_MODE="${raw}"; expected "detect_only" or "auto_heal"`)
}
