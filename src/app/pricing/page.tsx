"use client"

import { useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { PageShell } from "@/components/shared/page-shell"
import { PlanCard } from "@/components/pricing/plan-card"

const FREE_FEATURES = [
  { text: "1 workspace", included: true },
  { text: "3 agents per workspace", included: true },
  { text: "Self-hosted export only", included: true },
  { text: "Community support", included: true },
  { text: "Cloud deployment", included: false },
  { text: "$50/mo API spend limit", included: true },
]

const PRO_FEATURES = [
  { text: "5 workspaces", included: true },
  { text: "10 agents per workspace", included: true },
  { text: "Cloud deployment ($12/mo per workspace)", included: true },
  { text: "Priority support", included: true },
  { text: "All templates", included: true },
  { text: "$200/mo API spend limit", included: true },
]

const ENTERPRISE_FEATURES = [
  { text: "Unlimited workspaces", included: true },
  { text: "50 agents per workspace", included: true },
  { text: "Cloud deployment (included)", included: true },
  { text: "Dedicated support + SLA", included: true },
  { text: "All templates", included: true },
  { text: "Custom API spend limit", included: true },
]

export default function PricingPage() {
  const { data: session } = useSession()
  const router = useRouter()
  const [loading, setLoading] = useState(false)

  const handlePlanAction = async (plan: "FREE" | "PRO" | "ENTERPRISE") => {
    if (plan === "FREE") {
      router.push(session?.user ? "/my-claws" : "/auth/signin")
      return
    }

    if (plan === "ENTERPRISE") {
      window.location.href = "mailto:sales@buildclaws.ai?subject=Enterprise Plan Inquiry"
      return
    }

    if (!session?.user) {
      router.push("/auth/signin?callbackUrl=/pricing")
      return
    }

    setLoading(true)
    try {
      const res = await fetch("/api/dodo-payments/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "plan_upgrade", plan }),
      })
      const data = await res.json()
      if (data.data?.mockMode && data.data?.redirectUrl) {
        router.push(data.data.redirectUrl)
      } else if (data.data?.checkoutUrl) {
        window.location.href = data.data.checkoutUrl
      }
    } catch {
      console.error("Plan upgrade failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    <PageShell background="primary">
      <div className="max-w-4xl mx-auto px-4 py-6 text-center">
        <h1 className="text-xl font-semibold mb-1">Simple, transparent pricing</h1>
        <p className="text-[13px] text-[var(--tx2)] mb-5">
          Start free. Upgrade when your AI agents start making you money.
        </p>

        <div className="grid grid-cols-3 gap-3.5">
          <PlanCard name="Free" price="$0" period="forever" features={FREE_FEATURES} ctaLabel="Get started free" ctaVariant="outline" onCta={() => handlePlanAction("FREE")} />
          <PlanCard name="Pro" price="$29" period="per month" featured features={PRO_FEATURES} ctaLabel={loading ? "Processing..." : "Upgrade to Pro"} ctaVariant="primary" onCta={() => handlePlanAction("PRO")} />
          <PlanCard name="Enterprise" price="$99" period="per month" features={ENTERPRISE_FEATURES} ctaLabel="Contact sales" ctaVariant="outline" onCta={() => handlePlanAction("ENTERPRISE")} />
        </div>

        <div className="border border-[var(--bd)] rounded-xl p-3.5 text-left mt-5">
          <h3 className="text-[13px] font-semibold mb-1.5">How pricing works</h3>
          <p className="text-xs text-[var(--tx2)] leading-loose">
            <strong>1. Platform fee</strong> — Free, $29/mo, or $99/mo. Your Claws subscription for the visual builder, dashboard, and support.<br />
            <strong>2. Claw purchase</strong> — One-time fee ($199–$999) to unlock a pre-built agent template. Yours forever.<br />
            <strong>3. Monthly support</strong> — $39–$99/mo per Claw for template updates, new skills, and priority fixes.<br />
            <strong>4. Cloud hosting</strong> — $12/mo per workspace if you want us to run your agents. Free tier: export and self-host.<br />
            <strong>5. AI model costs</strong> — You pay your AI provider directly (Anthropic, OpenAI). We never touch your API spend. Typical: $50–200/mo per Claw.
          </p>
        </div>

        <p className="text-xs text-[var(--tx2)] mt-3">7-day money-back guarantee on all purchases.</p>
      </div>
    </PageShell>
  )
}
