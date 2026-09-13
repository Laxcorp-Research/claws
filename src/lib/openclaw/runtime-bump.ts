/**
 * Classify an OpenClawVersion bump. YYYY.M.D is not semver.
 * Auto-promote is allowed only for overlay -N (same upstream git tag).
 */

export type RuntimeBumpClass = "overlay-N" | "upstream-revision" | "date-tuple"

export function upstreamDateTuple(version: string): string {
  const trimmed = version.trim()
  const match = trimmed.match(/^(\d{4}\.\d+\.\d+)/)
  return match?.[1] ?? trimmed
}

function sourceTag(
  version: string,
  buildSourceTag?: string | null,
): string {
  const tagged = (buildSourceTag ?? "").trim()
  if (tagged.length > 0) return tagged
  return `v${upstreamDateTuple(version)}`
}

export function classifyRuntimeBump(
  currentStable: { version: string; buildSourceTag?: string | null },
  candidate: { version: string; buildSourceTag?: string | null },
): RuntimeBumpClass {
  const curTuple = upstreamDateTuple(currentStable.version)
  const candTuple = upstreamDateTuple(candidate.version)
  if (curTuple !== candTuple) return "date-tuple"
  const curSrc = sourceTag(currentStable.version, currentStable.buildSourceTag)
  const candSrc = sourceTag(candidate.version, candidate.buildSourceTag)
  if (curSrc === candSrc) return "overlay-N"
  return "upstream-revision"
}

export function mayAutoPromoteOverlayN(bump: RuntimeBumpClass): boolean {
  return bump === "overlay-N"
}

export const ORPHAN_CANDIDATE_VERSIONS = [
  "2026.6.10",
  "2026.6.11",
  "2026.7.1",
  "2026.7.1-2",
  "2026.8.1",
  "2026.9.2",
] as const

export const STALE_CANDIDATE_MS = 14 * 24 * 60 * 60 * 1000
export const STALE_PING_COOLDOWN_MS = 24 * 60 * 60 * 1000
