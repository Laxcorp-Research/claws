"use client"

import Link from "next/link"
import { Gift } from "lucide-react"
import { Button } from "@/components/ui/button"

interface CreditBalanceCardProps {
  variant: "full" | "compact"
  balanceCents: number
  totalConsumedCents: number
  initialGrantCents: number
  status: "ACTIVE" | "EXHAUSTED" | "SUSPENDED" | "CONVERTED" | null
}

function formatDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

export function CreditBalanceCard({
  variant,
  balanceCents,
  totalConsumedCents,
  initialGrantCents,
  status,
}: CreditBalanceCardProps) {
  const pct = initialGrantCents > 0 ? Math.max(0, Math.min(100, (balanceCents / initialGrantCents) * 100)) : 0
  const isLow = balanceCents > 0 && balanceCents < 500
  const isExhausted = status === "EXHAUSTED" || balanceCents <= 0

  const barColor = isExhausted
    ? "bg-[var(--err)]"
    : isLow
      ? "bg-[var(--warn)]"
      : "bg-[var(--ac)]"

  if (variant === "compact") {
    return (
      <div className="bg-[var(--bg2)] rounded-lg p-3">
        <div className="text-[10px] text-[var(--tx2)]">Credits remaining</div>
        <div className={`text-lg font-semibold mt-0.5 ${isLow ? "text-[var(--warn)]" : isExhausted ? "text-[var(--err)]" : ""}`}>
          {formatDollars(balanceCents)}
        </div>
        <div className="mt-1.5 h-[6px] rounded-full bg-[var(--bd)] overflow-hidden">
          <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
        </div>
        {isLow && !isExhausted && (
          <div className="text-[10px] text-[var(--warn)] mt-[2px]">Running low</div>
        )}
        {isExhausted && (
          <div className="text-[10px] text-[var(--err)] mt-[2px]">Credits exhausted</div>
        )}
      </div>
    )
  }

  return (
    <div className="border border-[var(--bd)] rounded-xl p-3.5 mb-3.5">
      <div className="flex items-center gap-2 mb-2">
        <Gift className="w-4 h-4 text-[var(--ac-text)]" />
        <h3 className="text-[13px] font-semibold">Claws Starter Credits</h3>
      </div>

      <div className="flex items-baseline justify-between mb-1.5">
        <span className={`text-lg font-semibold ${isLow ? "text-[var(--warn)]" : isExhausted ? "text-[var(--err)]" : ""}`}>
          {formatDollars(balanceCents)} remaining
        </span>
        <span className="text-[11px] text-[var(--tx3)]">of {formatDollars(initialGrantCents)}</span>
      </div>

      <div className="h-[6px] rounded-full bg-[var(--bd)] overflow-hidden mb-3">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
      </div>

      {!isExhausted && !isLow && (
        <p className="text-[11px] text-[var(--tx2)] mb-2 leading-[1.5]">
          You&apos;re using free credits from the Claws team.
          When these run out, add your own API key to continue.
        </p>
      )}

      {isLow && !isExhausted && (
        <p className="text-[11px] text-[var(--warn)] mb-2 leading-[1.5]">
          Running low — add your API key soon to avoid interruption.
        </p>
      )}

      {isExhausted && (
        <div className="mb-2">
          <p className="text-[11px] text-[var(--err)] mb-2 leading-[1.5]">
            Credits exhausted. Add your API key to resume your agents.
          </p>
          <div className="flex gap-1.5">
            <Button variant="primary" size="sm" className="text-[11px]" onClick={() => window.location.href = "/settings?tab=api-keys"}>
              Add your API key
            </Button>
            <Button variant="outline" size="sm" className="text-[11px]" onClick={() => window.location.href = "/settings?tab=billing"}>
              Subscribe ($79/mo)
            </Button>
          </div>
        </div>
      )}

      {totalConsumedCents > 0 && (
        <p className="text-[11px] text-[var(--tx3)]">
          Anthropic (Claude): {formatDollars(totalConsumedCents)} consumed
        </p>
      )}

      {!isExhausted && (
        <Link href="/settings?tab=usage" className="text-[11px] text-[var(--ac-text)] hover:underline mt-1.5 inline-block">
          View detailed usage →
        </Link>
      )}
    </div>
  )
}
