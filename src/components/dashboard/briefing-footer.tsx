"use client"

import type { ApiKeySource } from "@/generated/prisma/client"
import { formatCurrency } from "@/lib/utils/format"

// PR-6a: the v1 cost surface. Three states keyed off how the workspace pays
// for inference:
//   USER_OWN_KEY (BYOK)   → we have no spend data; disclose where to find it.
//   PLATFORM_CREDIT       → exhausted notice, else "$X.XX consumed", else hidden.
//   NONE / not-onboarded  → hidden (calm-by-default).
// Props come from the page's existing useCreditBalance() + workspace payload
// so we don't open a second poll.
//
// BYOK provider caveat: the platform is Anthropic-centric (the metering
// pipeline hardcodes provider ANTHROPIC) and the workspace payload carries no
// per-workspace provider, so the disclosure links to the Anthropic console.
// A provider-accurate link is a follow-up (needs provider in the payload).

const ANTHROPIC_USAGE_URL = "https://console.anthropic.com/settings/usage"
const footerClass = "mt-6 pt-3 border-t border-[var(--bd)] text-[11px] text-[var(--tx2)]"

interface BriefingFooterProps {
  apiKeySource?: ApiKeySource | null
  consumedCents?: number | null
  creditStatus?: "ACTIVE" | "EXHAUSTED" | "SUSPENDED" | "CONVERTED" | null
}

export function BriefingFooter({ apiKeySource, consumedCents, creditStatus }: BriefingFooterProps) {
  // BYOK: the user supplies their own provider key — we have no spend figure,
  // so point them at their provider console instead.
  if (apiKeySource === "USER_OWN_KEY") {
    return (
      <footer className={footerClass}>
        Running on your own API key.{" "}
        <a
          href={ANTHROPIC_USAGE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[var(--ac)] hover:underline"
        >
          View usage at console.anthropic.com →
        </a>
      </footer>
    )
  }

  // Platform credits. Exhausted takes precedence over the consumed amount —
  // the calm line just states the fact; the loud top-of-page banner owns the
  // "add a key / top up" CTA, so the footer doesn't duplicate the nag.
  if (apiKeySource === "PLATFORM_CREDIT") {
    if (creditStatus === "EXHAUSTED") {
      return <footer className={footerClass}>Credits exhausted.</footer>
    }
    if (consumedCents != null && consumedCents > 0) {
      return <footer className={footerClass}>{formatCurrency(consumedCents / 100)} consumed this period</footer>
    }
  }

  // NONE / not-yet-onboarded / nothing consumed → calm (no footer).
  return null
}
