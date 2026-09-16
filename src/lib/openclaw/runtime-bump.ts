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
/**
 * OWNER-PLANE NOISE FIX (2026-09-16): was 24h - after the 9.4-5 promote,
 * every unsoaked ancestor row would have paged the founder DAILY. Ancestors
 * are now excluded entirely (see isNewerRuntimeVersion) and genuine stale
 * candidates ping at most once per 14 days per row.
 */
export const STALE_PING_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000

/**
 * Parse "YYYY.M.D" or "YYYY.M.D-N" into a comparable shape.
 * Returns null for unparseable versions (callers treat those conservatively).
 */
export function parseRuntimeVersion(
  version: string,
): { tuple: [number, number, number]; overlay: number } | null {
  const m = /^(\d{4})\.(\d{1,2})\.(\d{1,2})(?:-(\d+))?$/.exec(version.trim())
  if (!m) return null
  return {
    tuple: [Number(m[1]), Number(m[2]), Number(m[3])],
    overlay: m[4] ? Number(m[4]) : 0,
  }
}

/**
 * Compare two runtime versions: upstream date tuple first, then overlay -N
 * (missing -N compares as 0). Returns <0, 0, >0. Unparseable versions sort
 * BELOW any parseable version (they are never "newer than stable").
 */
export function compareRuntimeVersions(a: string, b: string): number {
  const pa = parseRuntimeVersion(a)
  const pb = parseRuntimeVersion(b)
  if (!pa && !pb) return 0
  if (!pa) return -1
  if (!pb) return 1
  for (let i = 0; i < 3; i++) {
    if (pa.tuple[i] !== pb.tuple[i]) return pa.tuple[i] - pb.tuple[i]
  }
  return pa.overlay - pb.overlay
}

/**
 * STALE-CANDIDATE SCOPE: only rows strictly NEWER than current stable are
 * candidates. Ancestors (older or equal, by upstream tuple then overlay -N)
 * are never candidates and never alert - the copy would otherwise advise
 * promoting an OLDER image. MUTATION: alerting on an ancestor row fails the
 * runtime-autoupdate ancestor tests.
 */
export function isNewerRuntimeVersion(candidate: string, stable: string): boolean {
  return compareRuntimeVersions(candidate, stable) > 0
}
