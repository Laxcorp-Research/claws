"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Check, ArrowRight, Gift } from "lucide-react"
import { PageShell } from "@/components/shared/page-shell"
import { TextLink } from "@/components/ui/text-link"
import { AlertBanner } from "@/components/ui/alert-banner"
import { LoadingSkeleton } from "@/components/ui/loading-skeleton"
import {
  TOOL_COUNT_MARKETING_FLOOR,
  formatToolCountFloorLabel,
} from "@/lib/tools/tool-count"

type PricingTemplate = {
  name: string
  price: number
  isFree: boolean
}

const PAID_TIER_META = [
  {
    priceValue: 49,
    price: "$49",
    subtitle: "Creator + Business",
    badge: { bg: "#EEF5FF", text: "#1A5BBF", border: "#A8CFFF" },
  },
  {
    priceValue: 99,
    price: "$99",
    subtitle: "Vertical + Money-Making",
    badge: { bg: "#FFF8E7", text: "#8A6D00", border: "#FFE9A0" },
  },
] as const

const STATIC_FEATURES = [
  "Cloud hosting (2Gi RAM, managed)",
  "All channels (Telegram, Slack, Discord, WhatsApp)",
  "Visual builder",
  "Real-time monitoring dashboard",
  "Auto-restart + health checks",
  "Template updates",
  "Priority email support",
] as const

/**
 * Batch A / A4: marketplace API is the sole catalog source for /pricing.
 * MUTATION: reintroduce the static claw-templates data import → grep-guard fails.
 */
export default function PricingPage() {
  const [templates, setTemplates] = useState<PricingTemplate[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [toolCountLabel, setToolCountLabel] = useState(
    formatToolCountFloorLabel(TOOL_COUNT_MARKETING_FLOOR),
  )

  useEffect(() => {
    let cancelled = false
    async function loadToolCount() {
      try {
        const res = await fetch("/api/tools/catalog-count")
        const json = await res.json()
        if (!cancelled && res.ok && json.success && typeof json.data?.label === "string") {
          setToolCountLabel(json.data.label)
        }
      } catch {
        /* keep fallback label */
      }
    }
    void loadToolCount()
    return () => {
      cancelled = true
    }
  }, [])

  const features = useMemo(
    () => [
      STATIC_FEATURES[0],
      STATIC_FEATURES[1],
      `${toolCountLabel} tool integrations`,
      ...STATIC_FEATURES.slice(2),
    ],
    [toolCountLabel],
  )

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const all: PricingTemplate[] = []
        let cursor: string | null = null
        // Paginate until exhausted (marketplace list max page = 50).
        for (let i = 0; i < 20; i++) {
          const params = new URLSearchParams({ limit: "50", sort: "popular" })
          if (cursor) params.set("cursor", cursor)
          const res = await fetch(`/api/marketplace/templates?${params}`)
          const json = await res.json()
          if (!res.ok || !json.success) {
            throw new Error(json.error?.message || "Failed to load templates")
          }
          const items = (json.data?.items ?? []) as Array<{
            name: string
            price: number
            isFree: boolean
          }>
          all.push(
            ...items.map((t) => ({
              name: t.name,
              price: t.price,
              isFree: t.isFree,
            })),
          )
          cursor = json.data?.nextCursor ?? null
          if (!cursor) break
        }
        if (!cancelled) setTemplates(all)
      } catch (err) {
        if (!cancelled) {
          setTemplates(null)
          setError(err instanceof Error ? err.message : "Failed to load pricing catalog")
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const byPrice = useMemo(() => {
    const groups: Record<number, string[]> = {}
    for (const t of templates ?? []) {
      const key = t.isFree || t.price === 0 ? 0 : t.price
      groups[key] ??= []
      groups[key].push(t.name)
    }
    return groups
  }, [templates])

  const freeTemplateNames = byPrice[0] ?? []

  const steps = [
    {
      num: "1",
      label: "Template",
      text: `Free or $49–$99 one-time. Pick a pre-built Claw. Yours forever on the platform. ${freeTemplateNames.length} templates are completely free.`,
    },
    {
      num: "2",
      label: "Platform fee",
      text: "$79/mo per running Claw. Everything included: hosting, channels, integrations, monitoring, updates.",
    },
    {
      num: "3",
      label: "AI model costs",
      text: "You bring your own API keys (Anthropic, OpenAI, Google). Pay your provider directly. Typical: $30–90/mo.",
    },
    {
      num: "4",
      label: "3-day free trial",
      text: "Your first deploy includes a free trial. No platform fee until day 4.",
    },
  ]

  return (
    <PageShell background="primary">
      <div className="max-w-4xl mx-auto px-4 py-6 text-center">
        <h1 className="text-[20px] font-semibold text-[var(--tx)] mb-1">Simple pricing</h1>
        <p className="text-[13px] text-[var(--tx2)] mb-5">
          Buy a template. Pay monthly to run it. No tiers.
        </p>

        {/* Platform fee card */}
        <div className="border-2 border-[var(--tx)] rounded-[12px] p-5 mb-5 text-center bg-gradient-to-b from-[var(--bg)] to-[var(--bg2)]">
          <p className="text-[11px] font-semibold tracking-widest uppercase text-[var(--tx3)] mb-1">
            Platform fee
          </p>
          <div className="text-[32px] font-bold text-[var(--tx)]">$79</div>
          <p className="text-[13px] text-[var(--tx2)]">per month, per running Claw</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-left text-[12px] text-[var(--tx2)] mt-4">
            {features.map((feature) => (
              <span key={feature} className="flex items-center gap-2">
                <Check className="w-3.5 h-3.5 text-[var(--ok)] flex-shrink-0" />
                {feature}
              </span>
            ))}
          </div>
          <p className="text-[12px] text-[var(--tx2)] mt-4 pt-3 border-t border-[var(--bd)]">
            One Claw is $79/mo. Two is $158/mo. Simple math, no volume tricks. Running 10+? Let&apos;s talk.
          </p>
        </div>

        <p className="text-[11px] font-semibold tracking-widest uppercase text-[var(--tx3)] mb-2 text-left">
          Templates - one-time purchase, yours forever
        </p>

        {loading && (
          <div className="mb-4 text-left">
            <LoadingSkeleton variant="card" count={2} />
          </div>
        )}

        {!loading && error && (
          <div className="mb-4 text-left">
            <AlertBanner variant="error">
              <p className="font-medium">Couldn&apos;t load the template catalog</p>
              <p className="mt-0.5 opacity-80">{error}</p>
            </AlertBanner>
          </div>
        )}

        {!loading && !error && templates && (
          <>
            <div className="border border-[var(--bd)] rounded-[12px] p-[14px] mb-2 text-left">
              <div className="flex items-center gap-2 mb-2">
                <span
                  className="text-[11px] font-semibold py-[2px] px-[8px] rounded-[4px] inline-flex items-center gap-1 border"
                  style={{ backgroundColor: "#EDFFF3", color: "#0D6B32", borderColor: "#B8FFCF" }}
                >
                  <Gift className="w-3 h-3" />
                  Free
                </span>
                <span className="text-[13px] font-semibold text-[var(--tx)]">
                  {freeTemplateNames.length} templates, free forever
                </span>
              </div>
              <p className="text-[13px] text-[var(--tx-muted)]">
                {freeTemplateNames.length > 0
                  ? freeTemplateNames.join(", ")
                  : "No free templates published yet."}
              </p>
              <TextLink href="/store?price=free" direction="forward" className="mt-2.5 inline-block">
                Browse free templates
              </TextLink>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-4">
              {PAID_TIER_META.map((tier) => {
                const names = byPrice[tier.priceValue] ?? []
                return (
                  <div
                    key={tier.price}
                    className="border border-[var(--bd)] rounded-[var(--r)] p-[14px_16px] text-center"
                  >
                    <span
                      className="text-[11px] font-semibold py-[2px] px-[8px] rounded-[4px] inline-block border"
                      style={{
                        backgroundColor: tier.badge.bg,
                        color: tier.badge.text,
                        borderColor: tier.badge.border,
                      }}
                    >
                      {tier.subtitle}
                    </span>
                    <div className="text-[22px] font-bold text-[var(--tx)] mt-2">{tier.price}</div>
                    <p className="text-[11px] text-[var(--tx3)] mt-[2px]">
                      {names.length} template{names.length !== 1 ? "s" : ""}
                    </p>
                    <p className="text-[13px] text-[var(--tx-muted)] mt-3">
                      {names.length > 0 ? names.join(", ") : "None at this price yet."}
                    </p>
                    <TextLink href="/store?price=paid" direction="forward" className="mt-3 inline-block">
                      Browse templates
                    </TextLink>
                  </div>
                )
              })}
            </div>
          </>
        )}

        <div className="border border-[var(--bd)] rounded-[12px] p-[14px] text-left mb-4">
          <h3 className="text-[13px] font-semibold text-[var(--tx)] mb-[6px]">How pricing works</h3>
          <div className="text-[12px] text-[var(--tx2)] space-y-3">
            {steps.map((step) => (
              <div key={step.num} className="flex gap-3 items-start">
                <span className="flex-shrink-0 w-[22px] h-[22px] rounded-full bg-[var(--bg2)] border border-[var(--bd)] flex items-center justify-center text-[11px] font-semibold text-[var(--tx)]">
                  {step.num}
                </span>
                <p>
                  <strong className="text-[var(--tx)]">{step.label}</strong> - {step.text}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-5 flex flex-col items-center gap-2">
          <Link
            href="/store"
            className="inline-flex items-center gap-2 bg-[var(--tx)] text-white px-6 py-2.5 rounded-[8px] text-[13px] font-medium hover:opacity-90 transition-opacity"
          >
            Browse templates
            <ArrowRight className="w-4 h-4" />
          </Link>
          <p className="text-[11px] text-[var(--tx3)]">
            No credit card required to browse. 3-day free trial on first deploy.
          </p>
        </div>
      </div>
    </PageShell>
  )
}
