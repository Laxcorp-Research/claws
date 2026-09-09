"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { StatCard } from "@/components/ui/stat-card"
import { StatusBadge } from "@/components/ui/status-badge"
import { Button } from "@/components/ui/button"
import { AlertBanner } from "@/components/ui/alert-banner"
import { LoadingSkeleton } from "@/components/ui/loading-skeleton"

interface BillingData {
  hasActiveSubscription: boolean
  subscriptionStatus?: string | null
  plan?: string
  planPrice?: string
  activeClaws: number
  runningClaws: number
  pausedClaws: number
  thisMonthTotal: number
  trialUsed: boolean
  trialStartedAt: string | null
  trialEndsAt: string | null
  nextBillingDate?: string
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

/** Success return from Dodo platform checkout (no cancel_url in Dodo SDK). */
export const BILLING_SUBSCRIBE_RETURN = "/settings?tab=billing&subscribed=1"

export function BillingDashboard() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const subscribedReturn = searchParams.get("subscribed") === "1"

  const [data, setData] = useState<BillingData | null>(null)
  const [workspaces, setWorkspaces] = useState<WorkspaceItem[]>([])
  const [loading, setLoading] = useState(true)
  const [portalLoading, setPortalLoading] = useState(false)
  const [subscribing, setSubscribing] = useState(false)
  const [subscribeMessage, setSubscribeMessage] = useState<string | null>(null)
  const [portalMessage, setPortalMessage] = useState<string | null>(null)

  const loadBilling = useCallback(async () => {
    const [billingJson, wsJson] = await Promise.all([
      fetch("/api/user/billing").then((r) => r.json()),
      fetch("/api/workspaces").then((r) => r.json()),
    ])
    if (billingJson.success) setData(billingJson.data)
    if (wsJson.success) setWorkspaces(wsJson.data ?? [])
  }, [])

  useEffect(() => {
    loadBilling().finally(() => setLoading(false))
  }, [loadBilling])

  // After Dodo return (?subscribed=1): refetch entitlement so redeploy gates unlock.
  useEffect(() => {
    if (!subscribedReturn) return
    void loadBilling()
  }, [subscribedReturn, loadBilling])

  const handleSubscribe = async () => {
    // MUTATION: marketing pricing navigation restored here → subscribe-checkout test fails.
    setSubscribing(true)
    setSubscribeMessage(null)
    try {
      const preferred =
        workspaces.find((w) => w.status === "STOPPED") ??
        workspaces.find((w) => w.status === "RUNNING" || w.status === "PAUSED") ??
        workspaces[0]
      const res = await fetch("/api/dodo-payments/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "claw_platform",
          ...(preferred ? { workspaceId: preferred.id } : {}),
          returnUrl: BILLING_SUBSCRIBE_RETURN,
        }),
      })
      const json = await res.json()
      if (json.data?.checkoutUrl) {
        window.location.href = json.data.checkoutUrl as string
        return
      }
      if (json.data?.mockMode) {
        await loadBilling()
        setSubscribeMessage("Subscription active (test mode).")
        return
      }
      setSubscribeMessage(json.error?.message || "Checkout unavailable. Please try again.")
    } catch {
      setSubscribeMessage("Couldn't start checkout. Please try again.")
    } finally {
      setSubscribing(false)
    }
  }

  const openPortal = async () => {
    // PR-7: open the tab synchronously (inside the click gesture) so the
    // post-fetch navigation isn't blocked as a popup. If the portal isn't
    // available (Dodo mock mode / no dodoCustomerId), close the blank tab
    // and surface the server's message instead of silently doing nothing.
    const win = window.open("about:blank", "_blank")
    setPortalLoading(true)
    setPortalMessage(null)
    try {
      const res = await fetch("/api/dodo-payments/portal", { method: "POST" })
      const json = await res.json()
      if (json.data?.portalUrl && win) {
        win.location.href = json.data.portalUrl
      } else {
        win?.close()
        setPortalMessage(json.data?.message || "Billing portal unavailable.")
      }
    } catch {
      win?.close()
      setPortalMessage("Couldn't reach the billing portal. Please try again.")
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

  // Batch A / A6: display-only estimate from API runningClaws (RUNNING only).
  // List may still show paused claws; they do not enter the × $79 math.
  const runningClaws = data.runningClaws
  const monthlyTotal = runningClaws * 79
  const listedWorkspaces = workspaces.filter(
    (w) => w.status === "RUNNING" || w.status === "PAUSED" || w.status === "STOPPED",
  )
  const stoppedWorkspaces = workspaces.filter((w) => w.status === "STOPPED")

  const now = new Date()
  const trialEnd = data.trialEndsAt ? new Date(data.trialEndsAt) : null
  const trialActive = trialEnd && trialEnd > now
  const trialExpired = data.trialUsed && !trialActive
  const onHold = data.subscriptionStatus === "on_hold"
  const showTrialExpiredBanner = trialExpired && !data.hasActiveSubscription && !onHold
  const showSubscribedBanner =
    data.hasActiveSubscription &&
    !onHold &&
    (subscribedReturn || Boolean(subscribeMessage?.includes("active")))

  const trialStatusLabel = !data.trialUsed
    ? "Available"
    : trialActive
      ? "Active"
      : "Ended"

  const trialTrend = !data.trialUsed
    ? "3-day platform trial on first deploy"
    : trialActive
      ? `Ends ${formatDate(data.trialEndsAt)} · $79/mo after`
      : data.hasActiveSubscription
        ? onHold
          ? "On hold - update your card"
          : "Subscribed - trial complete"
        : data.trialStartedAt
          ? `Ended · started ${formatDate(data.trialStartedAt)}`
          : "Trial ended - subscribe to redeploy"

  return (
    <div>
      {onHold && (
        <AlertBanner variant="warning">
          <p className="font-medium">Billing is on hold</p>
          <p className="mt-0.5 opacity-80">
            Update your card in Settings &gt; Billing. Grace access continues until the card is updated.
          </p>
        </AlertBanner>
      )}

      {showSubscribedBanner && (
        <AlertBanner variant="info">
          <p className="font-medium">Subscription active</p>
          <p className="mt-0.5 opacity-80">
            Platform entitlement is live. Redeploy stopped Claws from their dashboard.
          </p>
        </AlertBanner>
      )}

      {showTrialExpiredBanner && (
        <AlertBanner
          variant="warning"
          actions={
            <Button
              variant="primary"
              size="sm"
              loading={subscribing}
              onClick={handleSubscribe}
            >
              Subscribe - $79/mo
            </Button>
          }
        >
          <p className="font-medium">Your 3-day trial has ended</p>
          <p className="mt-0.5 opacity-80">Subscribe to keep your Claws running.</p>
        </AlertBanner>
      )}

      <h2 className="text-[14px] font-semibold mb-[2px]">Billing summary</h2>
      <p className="text-[11px] text-[var(--tx2)] mb-[12px]">You pay $79/mo per running Claw. No tiers, no surprises.</p>

      <div className="grid grid-cols-3 gap-[8px] my-[10px]">
        <StatCard label="Running Claws" value={runningClaws} trend="$79/mo each" />
        <StatCard
          label="Est. monthly"
          value={`$${monthlyTotal}`}
          trend={`${runningClaws} running Claw${runningClaws !== 1 ? "s" : ""} × $79`}
        />
        <StatCard label="Trial status" value={trialStatusLabel} trend={trialTrend} />
      </div>

      <div className="border border-[var(--bd)] rounded-[var(--r,8px)] p-[10px] my-[10px]">
        <h3 className="text-[12px] font-semibold mb-[6px]">Your Claws</h3>
        {listedWorkspaces.length === 0 ? (
          <p className="text-[11px] text-[var(--tx2)]">No running Claws. Deploy a Claw to start your subscription.</p>
        ) : (
          listedWorkspaces.map((ws) => (
            <div key={ws.id} className="flex justify-between items-center text-[11px] py-[4px] border-b border-[var(--bd)] last:border-0 gap-[8px]">
              <span className="font-medium">{ws.name}</span>
              <div className="flex items-center gap-[6px]">
                <StatusBadge status={mapStatus(ws.status)} />
                {ws.status === "STOPPED" && data.hasActiveSubscription && (
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => router.push(`/dashboard/${ws.id}`)}
                  >
                    Redeploy
                  </Button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {data.hasActiveSubscription && stoppedWorkspaces.length > 0 && (
        <p className="text-[11px] text-[var(--tx2)] mb-[10px]">
          {stoppedWorkspaces.length} stopped Claw{stoppedWorkspaces.length === 1 ? "" : "s"} - Redeploy is enabled.
        </p>
      )}

      <div className="flex gap-[6px]">
        {!data.hasActiveSubscription && !showTrialExpiredBanner && (
          <Button variant="primary" loading={subscribing} onClick={handleSubscribe}>
            Subscribe - $79/mo
          </Button>
        )}
        <Button variant="outline" onClick={openPortal} loading={portalLoading}>
          Manage subscription
        </Button>
        <Button variant="outline" onClick={openPortal} loading={portalLoading}>
          View invoices
        </Button>
      </div>
      {subscribeMessage && (
        <p role="status" className="text-[11px] text-[var(--tx2)] mt-[6px]">
          {subscribeMessage}
        </p>
      )}
      {portalMessage && (
        <p role="status" className="text-[11px] text-[var(--tx2)] mt-[6px]">
          {portalMessage}
        </p>
      )}
    </div>
  )
}
