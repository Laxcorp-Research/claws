"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { StatCard } from "@/components/ui/stat-card"
import { StatusBadge } from "@/components/ui/status-badge"
import { Button } from "@/components/ui/button"
import { AlertBanner } from "@/components/ui/alert-banner"
import { LoadingSkeleton } from "@/components/ui/loading-skeleton"

interface BillingData {
  hasActiveSubscription: boolean
  activeClaws: number
  runningClaws: number
  pausedClaws: number
  thisMonthTotal: number
  trialUsed: boolean
  trialStartedAt: string | null
  trialEndsAt: string | null
  isPastDue?: boolean
}

interface WorkspaceItem {
  id: string
  name: string
  status: string
}

function formatDate(iso: string | null): string {
  if (!iso) return ""
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function mapStatus(status: string): "running" | "paused" | "error" | "draft" | "setup" | "deploying" | "stopped" {
  const map: Record<string, "running" | "paused" | "error" | "draft" | "setup" | "deploying" | "stopped"> = {
    RUNNING: "running",
    PAUSED: "paused",
    ERROR: "error",
    DRAFT: "draft",
    SETUP_INCOMPLETE: "setup",
    DEPLOYING: "deploying",
    STOPPED: "stopped",
  }
  return map[status] ?? "draft"
}

export function BillingDashboard() {
  const router = useRouter()
  const [data, setData] = useState<BillingData | null>(null)
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([])
  const [loading, setLoading] = useState(true)
  const [portalLoading, setPortalLoading] = useState(false)

  useEffect(() => {
    Promise.all([
      fetch("/api/user/billing").then((r) => r.json()),
      fetch("/api/workspaces").then((r) => r.json()),
    ])
      .then(([billingJson, wsJson]) => {
        if (billingJson.success) setData(billingJson.data)
        if (wsJson.success) setWorkspaces(wsJson.data ?? [])
      })
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

  const activeWorkspaces = workspaces.filter((w) => w.status === "RUNNING" || w.status === "PAUSED")
  const activeClaws = activeWorkspaces.length
  const monthlyTotal = activeClaws * 79

  const now = new Date()
  const trialEnd = data.trialEndsAt ? new Date(data.trialEndsAt) : null
  const trialActive = trialEnd && trialEnd > now
  const trialExpired = data.trialUsed && !trialActive
  const showTrialExpiredBanner = trialExpired && !data.hasActiveSubscription

  const trialStatusLabel = !data.trialUsed
    ? "Available"
    : trialActive
      ? "Active"
      : "Used"

  const trialTrend = !data.trialUsed
    ? "3 days on first deploy"
    : trialActive
      ? `Expires ${formatDate(data.trialEndsAt)}`
      : data.trialStartedAt
        ? `Started ${formatDate(data.trialStartedAt)}`
        : "Trial used"

  return (
    <div>
      {showTrialExpiredBanner && (
        <AlertBanner
          variant="warning"
          actions={
            <Button variant="primary" size="sm" onClick={() => router.push("/pricing")}>
              Subscribe — $79/mo
            </Button>
          }
        >
          <p className="font-medium">Your 3-day trial has ended</p>
          <p className="mt-0.5 opacity-80">Subscribe to keep your Claws running.</p>
        </AlertBanner>
      )}

      {data.isPastDue && (
        <AlertBanner
          variant="error"
          actions={
            <Button variant="primary" size="sm" onClick={openPortal}>
              Update payment
            </Button>
          }
        >
          <p className="font-medium">Payment failed</p>
          <p className="mt-0.5 opacity-80">Update your payment method to keep Claws running.</p>
        </AlertBanner>
      )}

      <h2 className="text-[14px] font-semibold mb-[2px]">Billing summary</h2>
      <p className="text-[11px] text-[var(--tx2)] mb-[12px]">You pay $79/mo per running Claw. No tiers, no surprises.</p>

      <div className="grid grid-cols-3 gap-[8px] my-[10px]">
        <StatCard label="Active Claws" value={activeClaws} trend="$79/mo each" />
        <StatCard label="Monthly total" value={`$${monthlyTotal}`} trend="Platform fees only" />
        <StatCard label="Trial status" value={trialStatusLabel} trend={trialTrend} />
      </div>

      <div className="border border-[var(--bd)] rounded-[var(--r,8px)] p-[10px] my-[10px]">
        <h3 className="text-[12px] font-semibold mb-[6px]">Active subscriptions</h3>
        {activeWorkspaces.length === 0 ? (
          <p className="text-[11px] text-[var(--tx2)]">No running Claws. Deploy a Claw to start your subscription.</p>
        ) : (
          activeWorkspaces.map((ws) => (
            <div key={ws.id} className="flex justify-between items-center text-[11px] py-[4px] border-b border-[var(--bd)] last:border-0">
              <span className="font-medium">{ws.name}</span>
              <div className="flex items-center gap-[4px]">
                <StatusBadge status={mapStatus(ws.status)} />
                {/* TODO: Store next billing date from Dodo subscription webhook */}
                <span className="text-[var(--ok)]">· $79/mo · Active</span>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="flex gap-[6px]">
        <Button variant="outline" onClick={openPortal} loading={portalLoading}>
          Manage subscription
        </Button>
        <Button variant="outline" onClick={openPortal} loading={portalLoading}>
          View invoices
        </Button>
      </div>
    </div>
  )
}
