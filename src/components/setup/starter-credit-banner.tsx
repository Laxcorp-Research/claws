import { CheckCircle } from "lucide-react"
import { STARTER_CREDIT_CENTS, formatCreditDollars } from "@/lib/credits/constants"

/**
 * Resolve the dollar amount shown on the step-1 starter-credit banner.
 * Live balance when a CreditAccount exists; grant constant only when no row yet.
 * MUTATION: always return STARTER_CREDIT_CENTS → unit test (500¢ → "$5.00") fails.
 */
export function resolveStarterCreditBannerCents(opts: {
  hasCreditAccount: boolean
  balanceCents: number
}): number {
  return opts.hasCreditAccount ? opts.balanceCents : STARTER_CREDIT_CENTS
}

interface StarterCreditBannerProps {
  /** null = no CreditAccount row yet → fall back to grant constant. */
  balanceCents: number | null
}

export function StarterCreditBanner({ balanceCents }: StarterCreditBannerProps) {
  const cents = resolveStarterCreditBannerCents({
    hasCreditAccount: balanceCents !== null,
    balanceCents: balanceCents ?? 0,
  })

  return (
    <div className="bg-[var(--bg2)] border border-[var(--bd)] rounded-xl p-3.5 mb-3.5 flex items-start gap-2.5">
      <CheckCircle className="w-4 h-4 text-[var(--ok)] flex-shrink-0 mt-[1px]" />
      <div>
        <p className="text-[13px] font-medium mb-0.5">AI models powered by Claws Starter Credits</p>
        <p className="text-[11px] text-[var(--tx2)]">
          You have {formatCreditDollars(cents)} in free credits - no API key needed.
        </p>
      </div>
    </div>
  )
}
