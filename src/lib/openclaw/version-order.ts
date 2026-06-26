// Pure, client-safe version ordering for OpenClaw runtime versions.
//
// Version shape (from the image pipeline, register route VERSION_RE): a
// date-based base "YYYY.M.D" with an optional "-N" overlay-rebuild suffix —
// e.g. "2026.5.22" or "2026.5.22-3".
//
// Ordering (newest first):
//   2026.6.6 > 2026.5.22-4 > 2026.5.22-3 > 2026.5.22-2 > 2026.5.22
// Base is compared field-by-field numerically; then the suffix, where an
// ABSENT suffix == 0 (so a "-N" rebuild outranks the bare base), and suffixes
// compare numerically (so -10 > -9, not lexically).
//
// FAIL-SAFE: anything that doesn't parse (a non-pipeline tag like "latest",
// "candidate", "unknown", an env-fallback image, or outright garbage) makes
// compareOpenClawVersions() return 0. Callers therefore NEVER prompt or act on
// an unknown-direction comparison — an unregistered/garbage image triggers no
// update in either direction. This is intentional: the version-update banner
// and the per-workspace update action must be safe on whatever image a
// container happens to be running, registered or not.

export interface ParsedVersion {
  base: [number, number, number];
  /** 0 when there is no "-N" suffix. */
  suffix: number;
}

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-(\d+))?$/;

export function parseOpenClawVersion(version: string): ParsedVersion | null {
  if (typeof version !== 'string') return null;
  const m = VERSION_RE.exec(version.trim());
  if (!m) return null;
  return {
    base: [Number(m[1]), Number(m[2]), Number(m[3])],
    suffix: m[4] === undefined ? 0 : Number(m[4]),
  };
}

/**
 * Extracts the version tag from a docker image reference — the segment after
 * the final ':'. e.g. "ghcr.io/laxcorp-research/openclaw-runtime:2026.5.22-3"
 * -> "2026.5.22-3". Returns the input unchanged if there is no tag separator.
 * (An image tag never contains '/', so lastIndexOf(':') is correct for GHCR
 * refs that include a registry host without a port.)
 */
export function extractVersionFromImage(image: string): string {
  if (typeof image !== 'string') return '';
  const idx = image.lastIndexOf(':');
  return idx === -1 ? image : image.slice(idx + 1);
}

/**
 * Total order on OpenClaw version strings. Returns a negative number if a<b,
 * 0 if equal OR either side is unparseable (FAIL-SAFE — never assert a
 * direction we can't trust), a positive number if a>b. Suitable for Array.sort
 * and sign-based comparisons.
 */
export function compareOpenClawVersions(a: string, b: string): number {
  const pa = parseOpenClawVersion(a);
  const pb = parseOpenClawVersion(b);
  if (!pa || !pb) return 0; // fail-safe: unknown direction -> treat as equal
  for (let i = 0; i < 3; i++) {
    if (pa.base[i] !== pb.base[i]) return pa.base[i] - pb.base[i];
  }
  return pa.suffix - pb.suffix;
}

/** True iff `target` is a strictly newer, parseable version than `deployed`. */
export function isNewerVersion(target: string, deployed: string): boolean {
  return compareOpenClawVersions(target, deployed) > 0;
}
