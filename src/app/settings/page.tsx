"use client"

import { Suspense, useState, useEffect, useCallback } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { PageShell } from "@/components/shared/page-shell"
import { Tabs } from "@/components/ui/tabs"
import { AccountSettings } from "@/components/settings/account-settings"
import { ApiKeyManager } from "@/components/settings/api-key-manager"
import { BillingDashboard } from "@/components/settings/billing-dashboard"
import { SecuritySettings } from "@/components/settings/security-settings"

const TABS = [
  { id: "account", label: "Account" },
  { id: "api-keys", label: "API Keys" },
  { id: "billing", label: "Billing" },
  { id: "security", label: "Security" },
]

function SettingsContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { data: session } = useSession()

  const tabParam = searchParams.get("tab")
  const [activeTab, setActiveTab] = useState(tabParam && TABS.some((t) => t.id === tabParam) ? tabParam : "api-keys")

  useEffect(() => {
    if (tabParam && TABS.some((t) => t.id === tabParam) && tabParam !== activeTab) {
      setActiveTab(tabParam)
    }
  }, [tabParam, activeTab])

  const handleTabChange = useCallback((tabId: string) => {
    setActiveTab(tabId)
    router.replace(`/settings?tab=${tabId}`, { scroll: false })
  }, [router])

  const user = session?.user ? {
    id: session.user.id ?? "",
    name: session.user.name ?? null,
    email: session.user.email ?? "",
    image: session.user.image ?? null,
  } : null

  return (
    <PageShell>
      <div className="max-w-3xl mx-auto px-4 py-4">
        <Tabs tabs={TABS} activeTab={activeTab} onTabChange={handleTabChange} />

        {activeTab === "account" && user && <AccountSettings user={user} />}
        {activeTab === "api-keys" && <ApiKeyManager />}
        {activeTab === "billing" && <BillingDashboard />}
        {activeTab === "security" && <SecuritySettings />}

        {activeTab === "account" && !user && (
          <div className="text-center py-10 text-[var(--tx2)] text-[12px]">Loading account...</div>
        )}
      </div>
    </PageShell>
  )
}

export default function SettingsPage() {
  return (
    <Suspense fallback={
      <PageShell>
        <div className="max-w-3xl mx-auto px-4 py-4">
          <div className="h-8 bg-[var(--bg2)] rounded w-64 mb-4" />
          <div className="h-40 bg-[var(--bg2)] rounded-xl" />
        </div>
      </PageShell>
    }>
      <SettingsContent />
    </Suspense>
  )
}
