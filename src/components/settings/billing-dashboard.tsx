"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { StatCard } from "@/components/ui/stat-card"
import { Button } from "@/components/ui/button"
import { AlertBanner } from "@/components/ui/alert-banner"
import { LoadingSkeleton } from "@/components/ui/loading-skeleton"

interface BillingData {
  hasActiveSubscription: boolean
  plan: string
  planPrice: string
  activeClaws: number
  runningClaws: number
  pausedClaws: number
  thisMonthTotal: number
  nextBillingDate?: string
  isPastDue?: boolean
}

export function BillingDashboard() {
  const router = useRouter()
  const [data, setData] = useState<BillingData | null>(null)
  const [loading, setLoading] = useState(true)
  const [portalLoading, setPortalLoading] = useState(false)

  useEffect(() => {
    fetch("/api/user/billing")
      .then((r) => r.json())
      .then((json) => { if (json.success) setData(json.data) })
      .finally(() => setLoading(false))
  }, [])

  const openPortal = async () => {
    setPortalLoading(true)
    try {
      const res = await fetch("/api/dodo-payments/portal", { method: "POST" })
      const json = await res.json()
      if (json.data?.portalUrl) {
        window.open(json.data.portalUrl, "_blank")
      }
    } finally {
      setPortalLoading(false)
    }
  }

  if (loading) {
    return (
      <div>
        <div className="h-4 bg-[var(--bg2)] rounded w-40 mb-2" />
        <div className="grid grid-cols-3 gap-2">
          <LoadingSkeleton variant="card" count={1} />
          <LoadingSkeleton variant="card" count={1} />
          <LoadingSkeleton variant="card" count={1} />
        </div>
      </div>
    )
  }

  if (!data) return null

  const isInactive = !data.hasActiveSubscription

  return (
    <div>
      <h2 className="text-[14px] font-semibold mb-[2px]">Billing summary</h2>
      <p className="text-[11px] text-[var(--tx2)] mb-3">Manage your subscription and view usage.</p>

      {data.isPastDue && (
        <AlertBanner variant="error" actions={
          <Button variant="primary" size="xs" onClick={openPortal}>Update payment method</Button>
        }>
          Payment failed. Update your card to keep Claws running.
        </AlertBanner>
      )}

      <div className="grid grid-cols-3 gap-2 my-2.5">
        <StatCard label="Current plan" value={data.plan} trend={data.planPrice} />
        <StatCard label="Active Claws" value={data.activeClaws} trend={`${data.runningClaws} running, ${data.pausedClaws} paused`} />
        <StatCard label="This month" value={`$${data.thisMonthTotal.toFixed(0)}`} trend="API costs" />
      </div>

      <div className="flex gap-1.5 mt-0">
        {isInactive ? (
          <Button variant="primary" onClick={() => router.push("/pricing")}>View pricing</Button>
        ) : (
          <>
            <Button variant="outline" onClick={openPortal} loading={portalLoading}>Manage subscription</Button>
            <Button variant="outline" onClick={openPortal} loading={portalLoading}>View invoices</Button>
          </>
        )}
      </div>

      {data.nextBillingDate && (
        <p className="text-[10px] text-[var(--tx3)] mt-2">Next billing: {data.nextBillingDate}</p>
      )}
    </div>
  )
}
