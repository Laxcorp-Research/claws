"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { PageShell } from "@/components/shared/page-shell"
import { CategoryBadge, type ClawCategory } from "@/components/ui/category-badge"
import { AgentHierarchy } from "@/components/store/agent-hierarchy"
import { StatusBadge } from "@/components/ui/status-badge"
import { Button } from "@/components/ui/button"
import { LoadingSkeleton } from "@/components/ui/loading-skeleton"
import { mapWorkspaceStatus } from "@/lib/utils"
import Link from "next/link"

interface TemplateDetail {
  id: string
  name: string
  slug: string
  tagline: string
  description: string
  category: ClawCategory
  price: number
  isFree: boolean
  creatorId: string | null
  agentCount: number
  agents: { name: string; agentSlug: string; role: string; color: string; model: string; roleDescription: string }[]
  tools: { required: { name: string; slug: string }[]; recommended: { name: string; slug: string; alternatives?: string[] }[] }
  flowDescription: string
  legalDisclaimer?: string | null
}

interface OwnershipData {
  workspace: { id: string; status: string; name: string } | null
  count: number
}

export default function ClawDetailPage() {
  const params = useParams()
  const router = useRouter()
  const { data: session } = useSession()
  const slug = params.slug as string

  const [claw, setClaw] = useState<TemplateDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [purchasing, setPurchasing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ownership, setOwnership] = useState<OwnershipData | null>(null)

  useEffect(() => {
    fetch(`/api/templates/${slug}`)
      .then((r) => r.json())
      .then((json) => {
        if (json.success) setClaw(json.data)
        else setError("Template not found")
      })
      .catch(() => setError("Failed to load"))
      .finally(() => setLoading(false))
  }, [slug])

  useEffect(() => {
    if (!claw?.id || !session?.user) {
      setOwnership(null)
      return
    }
    fetch("/api/workspaces")
      .then((r) => r.json())
      .then((json) => {
        if (!json.data) return
        const matching = (json.data as Array<{ id: string; status: string; name: string; clawTemplateId: string | null; updatedAt: string }>)
          .filter((w) => w.clawTemplateId === claw.id)
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        setOwnership({
          workspace: matching[0] ?? null,
          count: matching.length,
        })
      })
      .catch(() => { /* ownership check failed silently */ })
  }, [claw?.id, session?.user])

  const handlePurchase = async () => {
    if (!session?.user) {
      router.push(`/auth/signin?callbackUrl=/store/${slug}`)
      return
    }
    if (!claw) return

    setPurchasing(true)
    setError(null)
    try {
      let checkoutType = "claw_purchase"
      if (claw.isFree) {
        checkoutType = "free_template"
      } else if (claw.creatorId) {
        checkoutType = "community_purchase"
      }

      const res = await fetch("/api/dodo-payments/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: checkoutType, templateId: claw.id }),
      })
      const data = await res.json()

      if (!res.ok || !data.success) {
        setError(data.error?.message || "Purchase failed")
        return
      }

      if (data.data?.redirectUrl) {
        router.push(data.data.redirectUrl)
        return
      }

      if (data.data?.checkoutUrl) {
        window.location.href = data.data.checkoutUrl
      }
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setPurchasing(false)
    }
  }

  if (loading) {
    return (
      <PageShell background="secondary">
        <div className="max-w-5xl mx-auto px-4 py-4">
          <LoadingSkeleton variant="line" />
          <LoadingSkeleton variant="card" />
          <LoadingSkeleton variant="card" />
        </div>
      </PageShell>
    )
  }

  if (!claw) {
    return (
      <PageShell background="secondary">
        <div className="max-w-5xl mx-auto px-4 py-4 text-center py-10">
          <p className="text-[var(--tx2)]">{error || "Template not found"}</p>
          <Link href="/store" className="text-[var(--ac)] hover:text-[var(--tx)] text-[12px] mt-2 inline-block transition-colors">← Back to store</Link>
        </div>
      </PageShell>
    )
  }

  return (
    <PageShell background="secondary">
      <div className="max-w-5xl mx-auto px-4 py-4">
        <div className="text-[11px] text-[var(--tx2)] hover:text-[var(--tx)] transition-colors mb-2.5 cursor-pointer">
          <Link href="/store">← Back to store</Link>
        </div>

        <div className="flex justify-between items-start mb-3.5">
          <div>
            <CategoryBadge category={claw.category} />
            <h1 className="text-[22px] font-semibold text-[var(--tx)] mt-1.5">{claw.name}</h1>
            <div className="text-[13px] text-[var(--tx2)] mt-1 max-w-[520px] leading-relaxed">
              {claw.description}
            </div>
          </div>
          {ownership?.workspace ? (
            <div className="text-right flex-shrink-0 ml-6">
              <div className="flex items-center gap-1.5 justify-end">
                <StatusBadge status={mapWorkspaceStatus(ownership.workspace.status)} />
                <span className="text-[13px] font-medium text-[var(--tx)]">You own this Claw</span>
              </div>
              <Link href={`/dashboard/${ownership.workspace.id}`}>
                <Button variant="primary" size="default" className="mt-2.5 w-full">Open Dashboard</Button>
              </Link>
              <Link href={`/builder/${ownership.workspace.id}`}>
                <Button variant="outline" size="default" className="mt-1.5 w-full">Open Builder</Button>
              </Link>
              {ownership.count > 1 && (
                <Link
                  href="/my-claws"
                  className="text-[11px] text-[var(--ac)] hover:text-[var(--tx)] mt-2 inline-block transition-colors"
                >
                  View all {ownership.count} workspaces →
                </Link>
              )}
            </div>
          ) : (
            <div className="text-right flex-shrink-0 ml-6">
              {claw.isFree ? (
                <div className="text-[26px] font-semibold text-[var(--ok)]">Free</div>
              ) : (
                <>
                  <div className="text-[26px] font-semibold text-[var(--tx)]">${claw.price.toLocaleString()}</div>
                  <div className="text-[11px] text-[var(--tx2)]">one-time</div>
                </>
              )}
              <div className="text-[10px] text-[var(--tx3)] mt-0.5">+ $79/mo platform fee when running</div>
              <Button variant="primary" size="lg" className="mt-2.5" onClick={handlePurchase} loading={purchasing}>
                {!session?.user
                  ? "Sign in to purchase"
                  : claw.isFree
                    ? "Install — Free"
                    : `Purchase — $${claw.price.toLocaleString()}`}
              </Button>
              {error && <p className="text-[10px] text-[var(--err)] mt-1">{error}</p>}
            </div>
          )}
        </div>

        <div className="border border-[var(--bd)] rounded-[12px] p-3.5 mb-3.5">
          <h2 className="text-[13px] font-semibold mb-2.5">Agent team hierarchy</h2>
          <AgentHierarchy agents={claw.agents} />
        </div>

        <div className="grid grid-cols-2 gap-2.5 mb-3.5">
          <div className="border border-[var(--bd)] rounded-[12px] p-3.5">
            <h2 className="text-[13px] font-semibold mb-2">Required tools</h2>
            <div className="flex flex-col gap-1 text-[12px]">
              {claw.tools.required.map((tool) => (
                <div key={tool.slug} className="flex justify-between">
                  <span>{tool.name}</span>
                  <span className="text-[10px] text-[var(--ok)]">Connect during setup</span>
                </div>
              ))}
            </div>
          </div>
          <div className="border border-[var(--bd)] rounded-[12px] p-3.5">
            <div className="text-[13px] font-semibold mb-2">
              Recommended <span className="text-[10px] font-normal text-[var(--tx2)]">(swappable)</span>
            </div>
            <div className="flex flex-col gap-1 text-[12px]">
              {claw.tools.recommended.map((tool) => (
                <div key={tool.slug} className="flex justify-between">
                  <span>{tool.name}</span>
                  {tool.alternatives && tool.alternatives.length > 0 && (
                    <span className="text-[9px] text-[var(--tx3)]">or {tool.alternatives.join(", ")}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="text-[11px] text-[var(--tx2)] italic leading-normal py-2 px-3 bg-[var(--bg2)] rounded-[8px] border-l-[3px] border-[var(--bd)]">
          {claw.flowDescription}
        </div>

        {claw.legalDisclaimer && (
          <div className="text-[10px] text-[#92400e] bg-[var(--warnbg)] py-1.5 px-3 rounded-[8px] mt-2 border-l-[3px] border-[var(--warn)]">
            {claw.legalDisclaimer}
          </div>
        )}
      </div>
    </PageShell>
  )
}
