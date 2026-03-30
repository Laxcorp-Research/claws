import Link from "next/link"
import { PageShell } from "@/components/shared/page-shell"

const TIERS = [
  {
    label: "Standard",
    price: "$149",
    count: "8 templates",
    subtitle: "Creator + Lifestyle",
    badge: { bg: "#EDFFF3", text: "#0D6B32", border: "#B8FFCF" },
  },
  {
    label: "Business",
    price: "$199",
    count: "11 templates",
    subtitle: "Business Ops + Vertical",
    badge: { bg: "#EEF5FF", text: "#1A5BBF", border: "#A8CFFF" },
  },
  {
    label: "Premium",
    price: "$299",
    count: "1 template",
    subtitle: "Quant Trader",
    badge: { bg: "#FFF8E7", text: "#8A6D00", border: "#FFE9A0" },
  },
] as const

export default function PricingPage() {
  return (
    <PageShell background="primary">
      <div className="max-w-4xl mx-auto px-4 py-6 text-center">
        <h1 className="text-[20px] font-semibold text-[var(--tx)] mb-1">Simple pricing</h1>
        <p className="text-[13px] text-[var(--tx2)] mb-5">
          Buy a template. Pay monthly to run it. No tiers.
        </p>

        {/* Platform fee card */}
        <div className="border-2 border-[var(--tx)] rounded-[12px] p-5 mb-4 text-center">
          <p className="text-[11px] font-semibold tracking-widest uppercase text-[var(--tx3)] mb-1">
            Platform fee
          </p>
          <div className="text-[32px] font-bold text-[var(--tx)]">$79</div>
          <p className="text-[13px] text-[var(--tx2)]">per month, per running Claw</p>
          <div className="text-left text-[12px] text-[var(--tx2)] mt-3 leading-relaxed">
            Everything included: cloud hosting, all channels, 500+ tool integrations,
            visual builder, real-time monitoring, auto-restart, template updates, priority support
          </div>
          <p className="text-[12px] text-[var(--tx2)] mt-3">
            One Claw? $79/mo. Two? $158/mo. Three? $237/mo. Linear, predictable. 10+ Claws? Contact us.
          </p>
        </div>

        {/* Template tier label */}
        <p className="text-[11px] font-semibold tracking-widest uppercase text-[var(--tx3)] mb-2 text-left">
          Templates — one-time purchase, yours forever
        </p>

        {/* Template tier cards */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          {TIERS.map((tier) => (
            <div
              key={tier.label}
              className="border border-[var(--bd)] rounded-[var(--r)] p-[12px_14px] text-left"
            >
              <span
                className="text-[11px] font-semibold py-[2px] px-[8px] rounded-[4px] inline-block border"
                style={{
                  backgroundColor: tier.badge.bg,
                  color: tier.badge.text,
                  borderColor: tier.badge.border,
                }}
              >
                {tier.label}
              </span>
              <div className="text-[22px] font-bold text-[var(--tx)] mt-[6px]">{tier.price}</div>
              <p className="text-[11px] text-[var(--tx3)] mt-[2px]">{tier.count}</p>
              <p className="text-[11px] text-[var(--tx2)] mt-[6px]">{tier.subtitle}</p>
            </div>
          ))}
        </div>

        {/* How pricing works */}
        <div className="border border-[var(--bd)] rounded-[12px] p-[14px] text-left mb-4">
          <h3 className="text-[13px] font-semibold text-[var(--tx)] mb-[6px]">How pricing works</h3>
          <p className="text-[12px] text-[var(--tx2)] leading-relaxed">
            <strong>1. Template purchase</strong> — $149, $199, or $299 one-time. Pick a pre-built Claw. Yours forever on the platform.
            {" "}<strong>2. Platform fee</strong> — $79/mo per running Claw. Everything included: hosting, channels, integrations, monitoring, updates.
            {" "}<strong>3. AI model costs</strong> — You bring your own API keys (Anthropic, OpenAI, Google). Pay your provider directly. Typical: $30–90/mo.
            {" "}<strong>4. 3-day free trial</strong> — Your first deploy includes a free trial. No platform fee until day 4.
          </p>
        </div>

        {/* Footer */}
        <p className="text-[12px] text-[var(--tx2)]">
          3-day free trial on your first deploy. No platform fee charged until day 4.
        </p>
        <Link href="/store" className="text-[13px] text-[var(--ac)] hover:underline mt-2 inline-block">
          Browse templates →
        </Link>
      </div>
    </PageShell>
  )
}
