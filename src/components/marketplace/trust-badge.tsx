"use client"

import { Shield, ShieldCheck, Star, Circle } from "lucide-react"
import type { TrustTier } from "@/types/marketplace"
import { Tooltip } from "@/components/ui/tooltip"

interface TrustBadgeProps {
  tier: TrustTier
  className?: string
}

const TRUST_CONFIG: Record<TrustTier, {
  label: string
  title: string
  Icon: typeof Star
  bg: string
  text: string
  border: string
}> = {
  OFFICIAL: {
    label: "Official",
    title: "Official — built and maintained by the Claws team",
    Icon: Star,
    bg: "#FFF8E7",
    text: "#8A6D00",
    border: "#FFE9A0",
  },
  VERIFIED: {
    label: "Verified",
    title: "Verified — ran in an isolated sandbox (no credentials, network locked to the AI model)",
    Icon: ShieldCheck,
    bg: "#EDFFF3",
    text: "#0D6B32",
    border: "#B8FFCF",
  },
  SCANNED: {
    label: "Auto-scanned — automated checks passed",
    title: "Auto-scanned — automated checks passed (regex + AI review). Not a deeper runtime vetting result.",
    Icon: Shield,
    bg: "#EEF5FF",
    text: "#1A5BBF",
    border: "#A8CFFF",
  },
  UNREVIEWED: {
    label: "Unreviewed",
    title: "Unreviewed — awaiting human review; not listed publicly",
    Icon: Circle,
    bg: "#F5F5F5",
    text: "#777777",
    border: "#E0E0E0",
  },
}

export function TrustBadge({ tier, className = "" }: TrustBadgeProps) {
  const config = TRUST_CONFIG[tier]
  const { Icon } = config

  return (
    <Tooltip content={config.title} align="center" triggerClassName="inline-flex w-auto">
      <span
        className={`inline-flex items-center gap-[3px] rounded-[4px] px-2 py-[2px] text-[10px] font-semibold leading-tight ${className}`}
        style={{
          backgroundColor: config.bg,
          color: config.text,
          border: `1px solid ${config.border}`,
        }}
      >
        <Icon size={10} aria-hidden="true" />
        {config.label}
      </span>
    </Tooltip>
  )
}

/** Short legend for store surfaces — Verified mintable once sandbox vetting is live. */
export function TrustBadgeLegend({ className = "" }: { className?: string }) {
  return (
    <p className={`text-[11px] text-[var(--tx3)] leading-snug ${className}`}>
      <span className="font-medium text-[var(--tx2)]">Trust badges:</span>{" "}
      Official = Claws team. Verified — ran in an isolated sandbox (no credentials, network locked to the AI model). Auto-scanned = automated checks passed. Unreviewed items stay in the review queue and are not listed.
    </p>
  )
}
