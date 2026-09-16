// RUNTIME-9.4: version-keyed emission contract.
//
// KEEP (5) P0, 2026-09-13 07:41-08:01Z: after the 9.4 overlay landed on
// staging, every wake of the 5.22-18 KEEP canary received a 9.4-shaped
// openclaw.json (agents.entries + ownership + defaults.systemAgent +
// gateway.trustedProxies). The 5.22 gateway's strict Zod rejected it -
// "Gateway failed to start: Invalid config ... agents.defaults: Invalid
// input" - and the wake boot-looped to Railway FAILED, repeatedly. Emission
// MUST be keyed by the contract of the image actually being deployed, never
// by whatever shape the control-plane tip happens to speak.
//
// The contract is a property of the OpenClawVersion row (runtimeContract
// column, stamped at register time from the version string and backfilled by
// migration). This module owns the type and the derivation.

export type RuntimeContract = "5.22" | "9.4"

export function isRuntimeContract(value: unknown): value is RuntimeContract {
  return value === "5.22" || value === "9.4"
}

/**
 * Derive the emission contract from an OpenClaw version string
 * ("2026.5.22-18", "2026.9.4-5"). Upstream switched the config schema with
 * the 2026.9.4 release: keyed agents.entries + agents.ownership +
 * defaults.systemAgent + gateway.trustedProxies + OPENCLAW_CONFIG_READONLY.
 * Anything >= 2026.9.4 therefore speaks "9.4"; anything older speaks "5.22".
 *
 * OpenClaw versions are date tuples (YYYY.M.D with an optional -N stable
 * correction), NOT semver - compare as dates.
 */
export function deriveRuntimeContract(version: string): RuntimeContract {
  const m = /^(\d{4})\.(\d{1,2})\.(\d{1,2})(?:-\d+)?$/.exec(version.trim())
  if (!m) {
    throw new Error(
      `deriveRuntimeContract: unparseable OpenClaw version ${JSON.stringify(
        version,
      )} (expected YYYY.M.D or YYYY.M.D-N)`,
    )
  }
  // 2026.9.4 -> 20260904; numeric date-tuple comparison.
  const key = Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3])
  return key >= 20260904 ? "9.4" : "5.22"
}
