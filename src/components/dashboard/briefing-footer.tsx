"use client"

import { formatCurrency } from "@/lib/utils/format"

// PR-6: the only cost surface in v1. Shows credit consumed this period for
// credit users. For BYOK / not-yet-onboarded / null balance (totalConsumedCents
// nullish) and for anyone who hasn't consumed anything (=== 0), the footer is
// omitted entirely — calm-by-default, no empty "$0.00" line.
//
// `consumedCents` is passed in from the page's existing useCreditBalance()
// instance (credit.totalConsumedCents) so we don't open a second poll.

interface BriefingFooterProps {
  consumedCents?: number | null
}

export function BriefingFooter({ consumedCents }: BriefingFooterProps) {
  if (consumedCents == null || consumedCents === 0) return null

  return (
    <footer className="mt-6 pt-3 border-t border-[var(--bd)] text-[11px] text-[var(--tx2)]">
      {formatCurrency(consumedCents / 100)} consumed this period
    </footer>
  )
}
