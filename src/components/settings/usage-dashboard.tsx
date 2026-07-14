"use client"

import { useMemo } from "react"
import { LoadingSkeleton } from "@/components/ui/loading-skeleton"
import { TextLink } from "@/components/ui/text-link"
import { useCreditBalance } from "@/hooks/use-credit-balance"
import { useCreditUsage } from "@/hooks/use-credit-usage"
import { UsageSummary } from "@/components/credits/usage-summary"
import { UsageDailyChart } from "@/components/credits/usage-daily-chart"
import { UsageByModelTable } from "@/components/credits/usage-by-model-table"
import { UsageRecentTable } from "@/components/credits/usage-recent-table"

function computeThisMonthCents(
  daily: ReturnType<typeof useCreditUsage>["daily"],
): number {
  const now = new Date()
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  )
  let total = 0
  for (const d of daily) {
    const dayDate = new Date(d.date)
    if (!Number.isNaN(dayDate.getTime()) && dayDate >= monthStart) {
      total += d.totalCostCents
    }
  }
  return total
}

export function UsageDashboard() {
  const credit = useCreditBalance()
  const usage = useCreditUsage()

  const thisMonthCents = useMemo(
    () => computeThisMonthCents(usage.daily),
    [usage.daily],
  )

  const loading = credit.loading || usage.loading
  const hasUsage = usage.records.length > 0 || usage.daily.length > 0

  return (
    <div>
      <h2 className="text-[14px] font-semibold mb-[2px]">Credit usage</h2>
      <p className="text-[11px] text-[var(--tx2)] mb-[12px]">
        See where your Claws Starter Credits are going — by day, by model, and
        per API call.
      </p>

      <UsageSummary
        totalSpentCents={credit.totalConsumedCents}
        remainingCents={credit.balanceCents}
        thisMonthCents={thisMonthCents}
        loading={loading}
      />

      {loading ? (
        <div className="space-y-[16px]">
          <LoadingSkeleton variant="card" count={1} />
          <LoadingSkeleton variant="card" count={1} />
          <LoadingSkeleton variant="card" count={1} />
        </div>
      ) : !hasUsage ? (
        <div className="border border-[var(--bd)] rounded-[12px] p-[20px] text-center">
          <p className="text-[13px] text-[var(--tx)] mb-[4px]">
            No usage yet.
          </p>
          <p className="text-[11px] text-[var(--tx2)] mb-[12px]">
            Your credit usage will appear here once your agents start working.
          </p>
          <TextLink href="/my-claws" direction="forward">
            Go to My Claws
          </TextLink>
        </div>
      ) : (
        <>
          <section className="mb-[16px]">
            <h3 className="text-[12px] font-semibold mb-[6px]">
              Daily usage (last 30 days)
            </h3>
            <UsageDailyChart daily={usage.daily} />
          </section>

          <section className="mb-[16px]">
            <h3 className="text-[12px] font-semibold mb-[6px]">By model</h3>
            <UsageByModelTable
              daily={usage.daily}
              initialGrantCents={credit.initialGrantCents}
            />
          </section>

          <section className="mb-[16px]">
            <h3 className="text-[12px] font-semibold mb-[6px]">Recent activity</h3>
            <UsageRecentTable records={usage.records} />
          </section>
        </>
      )}

      {!loading && usage.error && (
        <p className="text-[11px] text-[var(--err)] mt-[8px]">{usage.error}</p>
      )}
    </div>
  )
}
