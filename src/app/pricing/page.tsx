"use client"

import { useState } from "react"
import { PageShell } from "@/components/shared/page-shell"
import { PricingCard } from "@/components/pricing/plan-card"

const STANDARD_TEMPLATES = [
  "YouTube Channel OS",
  "Twitter/X Growth Machine",
  "Newsletter Empire",
  "Podcast Production Studio",
  "Health & Fitness Commander",
  "Student Accelerator",
  "Job Hunter OS",
  "Developer Productivity OS",
]

const BUSINESS_TEMPLATES = [
  "B2B Sales Machine",
  "Agency Operations OS",
  "Founder's Chief of Staff",
  "SEO Empire Builder",
  "Real Estate Agent OS",
  "Recruiter OS",
  "Medical Practice Manager",
  "Law Firm Intake OS",
  "Home Services Dispatcher",
  "Freelancer Revenue Engine",
  "E-Commerce Profit Maximizer",
]

const PREMIUM_TEMPLATES = [
  "Quant Trader — multi-market trading intelligence",
]

const PLATFORM_FEATURES = [
  "Cloud deployment (2Gi RAM, managed container)",
  "All channels (Telegram, Discord, Slack, WhatsApp, Web)",
  "500+ tool integrations",
  "Visual builder",
  "Real-time monitoring dashboard",
  "Auto-restart + health checks",
  "Priority email support",
]

const FAQ_ITEMS = [
  { q: "Do I need my own API keys?", a: "Yes, you bring your own Anthropic/OpenAI keys. You control your costs directly with the provider." },
  { q: "Can I run multiple Claws?", a: "Yes, each running Claw is $79/mo. Paused Claws don't cost anything." },
  { q: "What's the free trial?", a: "3 days free on your first Claw. Full access, no restrictions." },
  { q: "Can I customize my Claw?", a: "Yes, the visual builder lets you edit agents, tools, and workflows after purchase." },
  { q: "What if I want a refund?", a: "7-day refund policy on all template purchases. No questions asked." },
]

export default function PricingPage() {
  const [openFaq, setOpenFaq] = useState<number | null>(null)

  return (
    <PageShell background="primary">
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="text-center mb-6">
          <h1 className="text-xl font-semibold text-[var(--tx)]">Simple, transparent pricing</h1>
          <p className="text-[13px] text-[var(--tx2)] mt-1">
            Buy a Claw. Deploy it. Pay only for what's running.
          </p>
        </div>

        <div className="border border-[var(--bd)] rounded-xl p-4 mb-6">
          <h2 className="text-[14px] font-semibold text-[var(--tx)] mb-3 text-center">How Claws works</h2>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="text-[22px] font-semibold text-[var(--tx)]">1</div>
              <p className="text-[12px] text-[var(--tx2)] mt-1">Pick a Claw from the store ($149–$299, one-time)</p>
            </div>
            <div>
              <div className="text-[22px] font-semibold text-[var(--tx)]">2</div>
              <p className="text-[12px] text-[var(--tx2)] mt-1">Set up your AI keys and tools (you own your API keys)</p>
            </div>
            <div>
              <div className="text-[22px] font-semibold text-[var(--tx)]">3</div>
              <p className="text-[12px] text-[var(--tx2)] mt-1">Deploy and run ($79/mo per running Claw — everything included)</p>
            </div>
          </div>
        </div>

        <h2 className="text-[14px] font-semibold text-[var(--tx)] mb-3 text-center">Template pricing</h2>
        <div className="grid grid-cols-3 gap-3.5 mb-6">
          <PricingCard
            tier="Standard"
            price={149}
            tagline="Perfect for creators and personal productivity"
            templates={STANDARD_TEMPLATES}
          />
          <PricingCard
            tier="Business"
            price={199}
            tagline="Built for revenue and operations"
            templates={BUSINESS_TEMPLATES}
            featured
          />
          <PricingCard
            tier="Premium"
            price={299}
            tagline="Advanced multi-market trading intelligence"
            templates={PREMIUM_TEMPLATES}
          />
        </div>

        <div className="border border-[var(--bd)] rounded-xl p-4 mb-6">
          <div className="text-center mb-3">
            <h2 className="text-[14px] font-semibold text-[var(--tx)]">$79/month per running Claw</h2>
            <p className="text-[11px] text-[var(--tx3)]">Everything included. No hidden fees.</p>
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 max-w-md mx-auto">
            {PLATFORM_FEATURES.map((feature) => (
              <p key={feature} className="text-[12px] text-[var(--tx2)]">
                {feature}
              </p>
            ))}
          </div>
          <div className="text-center mt-3 space-y-1">
            <p className="text-[12px] font-medium text-[var(--ac)]">3-day free trial on your first Claw</p>
            <p className="text-[11px] text-[var(--tx3)]">Pause or cancel anytime — only pay for running Claws</p>
          </div>
        </div>

        <div className="border border-[var(--bd)] rounded-xl p-4 mb-4">
          <h2 className="text-[14px] font-semibold text-[var(--tx)] mb-3 text-center">Frequently asked questions</h2>
          <div className="divide-y divide-[var(--bd)]">
            {FAQ_ITEMS.map((item, i) => (
              <div key={i} className="py-2.5">
                <button
                  className="w-full text-left flex justify-between items-center"
                  onClick={() => setOpenFaq(openFaq === i ? null : i)}
                >
                  <span className="text-[13px] font-medium text-[var(--tx)]">{item.q}</span>
                  <span className="text-[var(--tx3)] text-xs ml-2">{openFaq === i ? "−" : "+"}</span>
                </button>
                {openFaq === i && (
                  <p className="text-[12px] text-[var(--tx2)] mt-1.5">{item.a}</p>
                )}
              </div>
            ))}
          </div>
        </div>

        <p className="text-xs text-[var(--tx3)] text-center">7-day money-back guarantee on all purchases.</p>
      </div>
    </PageShell>
  )
}
