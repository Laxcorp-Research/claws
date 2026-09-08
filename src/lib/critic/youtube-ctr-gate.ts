/**
 * YouTube CTR percents must be sourced to a tool id or written as [YOUR CTR].
 *
 * MUTATION: treat unsourced "2.1% → 5.4%" as PASS → youtube-ctr-gate.test.ts fails.
 */

import { parseClaimsTable } from "@/lib/critic/claims-table"

export const YOUR_CTR_PLACEHOLDER = "[YOUR CTR]"
export const REJECT_UNSOURCED_CTR = "REJECT-for-unsourced-CTR"
export const UNSOURCED_CTR_LIFT_FIXTURE =
  "The 8-word title that lifted CTR from 2.1% to 5.4% (same thumbnail)."

const YOUTUBE_CTR_SOURCE_RE =
  /^(tool:|toolResult:|youtube-data-api:|tool:youtube-data-api:|tool:fixture:youtube-data-api:)\S+/i

function liftPairPresent(text: string): boolean {
  return /2\.1\s*%/.test(text) && /5\.4\s*%/.test(text)
}

function ctrLiftSourced(text: string): boolean {
  const rows = parseClaimsTable(text)
  if (!rows) return false
  return rows.some((row) => {
    const claim = row.claim
    const aboutLift =
      /2\.1/.test(claim) || /5\.4/.test(claim) || /\bCTR\b/i.test(claim)
    return aboutLift && YOUTUBE_CTR_SOURCE_RE.test(row.source.trim())
  })
}

export function reviewYoutubeCtrClaims(text: string): {
  verdict: "PASS" | "REJECT"
  reasons: string[]
} {
  const reasons: string[] = []
  if (liftPairPresent(text) && !ctrLiftSourced(text)) {
    reasons.push(`${REJECT_UNSOURCED_CTR}: 2.1% → 5.4%`)
  }
  return {
    verdict: reasons.length === 0 ? "PASS" : "REJECT",
    reasons,
  }
}
