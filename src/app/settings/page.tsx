"use client"

import { Suspense, useState, useEffect, useCallback } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { PageShell } from "@/components/shared/page-shell"
import { AccountSettings } from "@/components/settings/account-settings"
import { ApiKeyManager } from "@/components/settings/api-key-manager"
import { BillingDashboard } from "@/components/settings/billing-dashboard"
import { SecuritySettings } from "@/components/settings/security-settings"
import { cn } from "@/lib/utils"
import { Palette } from "lucide-react"

const TABS = [
  { id: "account", label: "Account" },
  { id: "api-keys", label: "API Keys" },
  { id: "billing", label: "Billing" },
  { id: "security", label: "Security" },
  { id: "creator", label: "Creator" },
] as const

type TabId = (typeof TABS)[number]["id"]

function CreatorPlaceholder() {
  return (
    <div className="text-center py-[40px]">
      <Palette className="w-10 h-10 text-[var(--tx3)] mx-auto" />
      <h3 className="text-[15px] font-semibold mt-[8px] mb-[4px]">Creator Dashboard</h3>
      <p className="text-[12px] text-[var(--tx2)] mb-[12px] max-w-[360px] mx-auto">
        Publish templates and skills to the marketplace. Earn money from your creations with 0% commission.
      </p>
      <p className="text-[11px] text-[var(--tx3)]">Coming soon</p>
    </div>
  )
}

function SettingsContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { data: session } = useSession()

  const tabParam = searchParams.get("tab")
  const validTab = TABS.some((t) => t.id === tabParam) ? (tabParam as TabId) : null
  const [activeTab, setActiveTab] = useState<TabId>(validTab ?? "api-keys")

  useEffect(() => {
    if (validTab && validTab !== activeTab) {
      setActiveTab(validTab)
    }
  }, [validTab, activeTab])

  const handleTabChange = useCallback((tabId: TabId) => {
    setActiveTab(tabId)
    router.replace(`/settings?tab=${tabId}`, { scroll: false })
  }, [router])

  const handleTabKeyDown = useCallback((e: React.KeyboardEvent) => {
    const tabIds = TABS.map((t) => t.id)
    const currentIndex = tabIds.indexOf(activeTab)
    let nextIndex = currentIndex

    if (e.key === "ArrowRight") {
      e.preventDefault()
      nextIndex = currentIndex < tabIds.length - 1 ? currentIndex + 1 : 0
    } else if (e.key === "ArrowLeft") {
      e.preventDefault()
      nextIndex = currentIndex > 0 ? currentIndex - 1 : tabIds.length - 1
    } else if (e.key === "Home") {
      e.preventDefault()
      nextIndex = 0
    } else if (e.key === "End") {
      e.preventDefault()
      nextIndex = tabIds.length - 1
    } else {
      return
    }

    handleTabChange(tabIds[nextIndex])
    setTimeout(() => {
      const tabEl = document.querySelector(`[role="tab"][aria-selected="true"]`) as HTMLElement
      tabEl?.focus()
    }, 0)
  }, [activeTab, handleTabChange])

  const user = session?.user ? {
    id: session.user.id ?? "",
    name: session.user.name ?? null,
    email: session.user.email ?? "",
    image: session.user.image ?? null,
  } : null

  return (
    <PageShell>
      <div className="max-w-3xl mx-auto px-[16px] py-[16px]">
        <h1 className="sr-only">Settings</h1>

        <div className="flex border-b border-[var(--bd)] mb-[16px]" role="tablist" aria-label="Settings">
          {TABS.map((tab) => {
            const active = tab.id === activeTab
            return (
              <button
                key={tab.id}
                id={`tab-${tab.id}`}
                role="tab"
                aria-selected={active}
                aria-controls={`panel-${tab.id}`}
                tabIndex={active ? 0 : -1}
                onClick={() => handleTabChange(tab.id)}
                onKeyDown={handleTabKeyDown}
                className={cn(
                  "px-[12px] py-[8px] text-[13px] cursor-pointer border-b-2 transition-colors",
                  active
                    ? "font-semibold text-[var(--tx)] border-b-[var(--tx)]"
                    : "font-medium text-[var(--tx2)] border-transparent hover:text-[var(--tx)]"
                )}
              >
                {tab.label}
              </button>
            )
          })}
        </div>

        <div role="tabpanel" id={`panel-${activeTab}`} aria-labelledby={`tab-${activeTab}`} tabIndex={0}>
          {activeTab === "account" && user && <AccountSettings user={user} />}
          {activeTab === "account" && !user && (
            <div className="text-center py-10 text-[var(--tx2)] text-[12px]">Loading account...</div>
          )}
          {activeTab === "api-keys" && <ApiKeyManager />}
          {activeTab === "billing" && <BillingDashboard />}
          {activeTab === "security" && <SecuritySettings />}
          {activeTab === "creator" && <CreatorPlaceholder />}
        </div>
      </div>
    </PageShell>
  )
}

export default function SettingsPage() {
  return (
    <Suspense fallback={
      <PageShell>
        <div className="max-w-3xl mx-auto px-[16px] py-[16px]">
          <div className="h-8 bg-[var(--bg2)] rounded w-64 mb-4" />
          <div className="h-40 bg-[var(--bg2)] rounded-xl" />
        </div>
      </PageShell>
    }>
      <SettingsContent />
    </Suspense>
  )
}
