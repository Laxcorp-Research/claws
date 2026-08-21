/**
 * Version hygiene - which OpenClawVersion rows may never be promoted to stable.
 *
 * Raw-calendar upstream tags (bare YYYY.M.D, placeholders like 2026.6.x) and the
 * seed relic 2.5.0 are never-promotable. Claws rebuilds always carry a `-N`
 * suffix (e.g. 2026.5.22-9).
 *
 * MUTATION: dropping the bare-calendar check → promotable-junk tests fail.
 */

import { compareOpenClawVersions } from "@/lib/openclaw/version-order"

/** Seed bootstrap row - never a real Claws runtime promote target. */
export const SEED_RELIC_VERSION = "2.5.0"

/**
 * Latest badge id among promotable rows only.
 * Never-promotable junk (seed relic / bare calendar) must not win "Latest"
 * even when compareOpenClawVersions ranks them highest.
 * MUTATION: drop the !isNeverPromotableVersion filter → badge tests fail.
 */
export function selectLatestVersionId(
  versions: ReadonlyArray<{ id: string; version: string }>,
): string | null {
  const eligible = versions.filter((v) => !isNeverPromotableVersion(v.version))
  if (eligible.length === 0) return null
  return eligible.reduce((newest, v) =>
    compareOpenClawVersions(v.version, newest.version) > 0 ? v : newest,
  ).id
}

/**
 * True when this version string must not be promoted to isStable via admin or
 * treated as a claws rebuild promote target.
 */
export function isNeverPromotableVersion(version: string): boolean {
  return neverPromotableReason(version) !== null
}

/** Human reason for UI badge / API 400, or null if promotable. */
export function neverPromotableReason(version: string): string | null {
  if (typeof version !== "string") return "invalid version"
  const v = version.trim()
  if (v.length === 0) return "empty version"
  if (v === SEED_RELIC_VERSION) {
    return "seed relic (2.5.0) - never promotable"
  }
  // Placeholder raw-calendar junk (e.g. 2026.6.x)
  if (/\.x\b/i.test(v)) {
    return "raw-calendar placeholder - never promotable"
  }
  // Bare YYYY.M.D (no claws -N rebuild suffix) = upstream calendar tag
  if (/^\d{4}\.\d+\.\d+$/.test(v)) {
    return "raw-calendar upstream tag - never promotable (needs claws -N rebuild)"
  }
  return null
}

/**
 * Claws rebuild shape that may be promoted: YYYY.M.D-N
 * MUTATION: treating bare YYYY.M.D as promotable → junk promote tests fail.
 */
export function isPromotableClawsRebuild(version: string): boolean {
  return /^\d{4}\.\d+\.\d+-\d+$/.test(version.trim())
}
