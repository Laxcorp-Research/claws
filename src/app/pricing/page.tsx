import Link from "next/link"
import { Check, ArrowRight, Gift } from "lucide-react"
import { PageShell } from "@/components/shared/page-shell"
import { CLAW_TEMPLATES } from "@/data/claw-templates"
import { TextLink } from "@/components/ui/text-link"

const PAID_TIERS = [
  {
    priceValue: 49,
    price: "$49",
    count: "8 templates",
    subtitle: "Creator + Business",
    badge: { bg: "#EEF5FF", text: "#1A5BBF", border: "#A8CFFF" },
  },
  {
    priceValue: 99,
    price: "$99",
    count: "7 templates",
    subtitle: "Vertical + Money-Making",
    badge: { bg: "#FFF8E7", text: "#8A6D00", border: "#FFE9A0" },
  },
] as const

const TEMPLATE_NAMES_BY_PRICE = CLAW_TEMPLATES.reduce<Record<number, string[]>>(
  (groups, template) => {
    groups[template.price] ??= []
    groups[template.price].push(template.name)
    return groups
  },
  {},
)

const FEATURES = [
  "Cloud hosting (2Gi RAM, managed)",
  "All channels (Telegram, Slack, Discord, WhatsApp)",
  "500+ tool integrations",
  "Visual builder",
  "Real-time monitoring dashboard",
  "Auto-restart + health checks",
  "Template updates",
  "Priority email support",
]

const STEPS = [
  { num: "1", label: "Template", text: "Free or $49\u2013$99 one-time. Pick a pre-built Claw. Yours forever on the platform. 5 templates are completely free." },
  { num: "2", label: "Platform fee", text: "$79/mo per running Claw. Everything included: hosting, channels, integrations, monitoring, updates." },
  { num: "3", label: "AI model costs", text: "You bring your own API keys (Anthropic, OpenAI, Google). Pay your provider directly. Typical: $30\u201390/mo." },
  { num: "4", label: "3-day free trial", text: "Your first deploy includes a free trial. No platform fee until day 4." },
]

export default function PricingPage() {
  const freeTemplateNames = TEMPLATE_NAMES_BY_PRICE[0] ?? []

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
            {FEATURES.map((feature) => (
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

        {/* Template tier label */}
        <p className="text-[11px] font-semibold tracking-widest uppercase text-[var(--tx3)] mb-2 text-left">
          Templates - one-time purchase, yours forever
        </p>

        {/* Free templates highlight */}
        <div className="border border-[var(--bd)] rounded-[12px] p-[14px] mb-2 text-left">
          <div className="flex items-center gap-2 mb-2">
            <span
              className="text-[11px] font-semibold py-[2px] px-[8px] rounded-[4px] inline-flex items-center gap-1 border"
              style={{ backgroundColor: "#EDFFF3", color: "#0D6B32", borderColor: "#B8FFCF" }}
            >
              <Gift className="w-3 h-3" />
              Free
            </span>
            <span className="text-[13px] font-semibold text-[var(--tx)]">{freeTemplateNames.length} templates, free forever</span>
          </div>
          <p className="text-[13px] text-[var(--tx-muted)]">
            {freeTemplateNames.join(", ")}
          </p>
          <TextLink href="/store?price=free" direction="forward" className="mt-2.5 inline-block">Browse free templates</TextLink>
        </div>

        {/* Paid template tier cards */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          {PAID_TIERS.map((tier) => (
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
              <p className="text-[11px] text-[var(--tx3)] mt-[2px]">{tier.count}</p>
              <p className="text-[13px] text-[var(--tx-muted)] mt-3">
                {(TEMPLATE_NAMES_BY_PRICE[tier.priceValue] ?? []).join(", ")}
              </p>
              <TextLink href="/store?price=paid" direction="forward" className="mt-3 inline-block">Browse templates</TextLink>
            </div>
          ))}
        </div>

        {/* How pricing works */}
        <div className="border border-[var(--bd)] rounded-[12px] p-[14px] text-left mb-4">
          <h3 className="text-[13px] font-semibold text-[var(--tx)] mb-[6px]">How pricing works</h3>
          <div className="text-[12px] text-[var(--tx2)] space-y-3">
            {STEPS.map((step) => (
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

        {/* CTA */}
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
