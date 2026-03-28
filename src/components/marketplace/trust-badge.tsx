"use client"

import { Shield, ShieldCheck, Star, Circle } from "lucide-react"
import type { TrustTier } from "@/types/marketplace"

interface TrustBadgeProps {
  tier: TrustTier
  className?: string
}

const TRUST_CONFIG: Record<TrustTier, {
  label: string
  Icon: typeof Star
  bg: string
  text: string
  border: string
}> = {
  OFFICIAL: {
    label: "Official",
    Icon: Star,
    bg: "#FFF8E7",
    text: "#8A6D00",
    border: "#FFE9A0",
  },
  VERIFIED: {
    label: "Verified",
    Icon: ShieldCheck,
    bg: "#EDFFF3",
    text: "#0D6B32",
    border: "#B8FFCF",
  },
  SCANNED: {
    label: "Scanned",
    Icon: Shield,
    bg: "#EEF5FF",
    text: "#1A5BBF",
    border: "#A8CFFF",
  },
  UNREVIEWED: {
    label: "Unreviewed",
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
  )
}
