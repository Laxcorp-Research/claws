/**
 * Freelancer rate-floor rail. The Writer may still draft when a lead's
 * budget is below USER.md floor, but the proposal must flag the gap and
 * must not silently adopt the lead's number as the fee.
 *
 * MUTATION: silent $lead-budget price with no flag → test fails.
 */

export const BELOW_FLOOR_FLAG = "below your floor"

export const BELOW_FLOOR_WORKED_EXAMPLE = {
  floorUsd: 6000,
  leadBudgetUsd: 4000,
  silentProposal:
    "Price: $4,000 fixed. Three weeks, kickoff to final readout.",
  flaggedProposal:
    "Price: $6,000 (your floor). This lead's $4,000 budget is below your floor. I will not bid their number.",
} as const

const PRICE_LINE_RE = /(?:price|fee|bid)\s*[:.]?\s*\$?\s*([\d,]+)/gi

function parseUsd(raw: string): number | null {
  const n = Number(raw.replace(/,/g, ""))
  return Number.isFinite(n) ? n : null
}

export function extractPricedUsd(proposal: string): number[] {
  const out: number[] = []
  for (const match of proposal.matchAll(PRICE_LINE_RE)) {
    const n = parseUsd(match[1] ?? "")
    if (n !== null) out.push(n)
  }
  return out
}

export function proposalFlagsBelowFloor(args: {
  proposal: string
  floorUsd: number
  leadBudgetUsd: number
}): boolean {
  if (args.leadBudgetUsd >= args.floorUsd) return true
  const text = args.proposal
  const hasFlag = /below (your |the )?floor/i.test(text)
  if (!hasFlag) return false
  const priced = extractPricedUsd(text)
  const adoptedLead = priced.some((n) => n === args.leadBudgetUsd)
  return !adoptedLead
}
