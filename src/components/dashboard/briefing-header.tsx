"use client"

import { cn } from "@/lib/utils"

// Shared so the empty-state render path in the dashboard page shows the exact
// same greeting as the populated briefing header (single source of truth for
// time-of-day + first-name resolution).
export function clawGreeting(name?: string | null): string {
  const hour = new Date().getHours()
  const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"
  const first = (name ?? "").trim().split(/\s+/)[0] || "there"
  return `${part}, ${first}.`
}

type PillTone = "ok" | "warn" | "error" | "muted" | "info"

interface HealthPill {
  label: string
  tone: PillTone
}

// Mirrors the dashboard alerts precedence (operator-intent lifecycle states
// first, then genuine unreachability, then degraded/config-drift, then
// healthy). Quiet tones (ok/muted) render text-only; loud tones (warn/error/
// info) get a tinted background — "quiet when healthy, loud when not".
export function healthPill(
  status: string,
  healthStatus: string,
  lastHealthReason?: string | null,
): HealthPill {
  if (status === "PAUSED") return { label: "Paused", tone: "muted" }
  if (status === "STOPPED") return { label: "Stopped", tone: "muted" }
  if (status === "HIBERNATED") return { label: "Hibernating", tone: "muted" }
  if (status === "WAKING") return { label: "Waking up", tone: "info" }
  if (status === "ERROR" || healthStatus === "UNHEALTHY") return { label: "Not responding", tone: "error" }
  if (healthStatus === "DEGRADED") {
    const configDrift = lastHealthReason === "bad-token" || lastHealthReason === "plugin-not-loaded"
    return { label: configDrift ? "Older config" : "Needs attention", tone: "warn" }
  }
  return { label: "All healthy", tone: "ok" }
}

const pillBg: Record<PillTone, string> = {
  ok: "text-[var(--tx2)]",
  muted: "text-[var(--tx3)]",
  warn: "bg-[var(--warnbg)] text-[#92400e]",
  error: "bg-[var(--errbg)] text-[#991b1b]",
  info: "bg-[var(--acbg)] text-[var(--ac)]",
}

const pillDot: Record<PillTone, string> = {
  ok: "bg-[var(--ok)]",
  muted: "bg-[var(--tx3)]",
  warn: "bg-[var(--warn)]",
  error: "bg-[var(--err)]",
  info: "bg-[var(--ac)]",
}

interface BriefingHeaderProps {
  name?: string | null
  status: string
  healthStatus: string
  lastHealthReason?: string | null
}

export function BriefingHeader({ name, status, healthStatus, lastHealthReason }: BriefingHeaderProps) {
  const pill = healthPill(status, healthStatus, lastHealthReason)

  return (
    <header className="mb-6 flex items-start justify-between gap-3 flex-wrap">
      <h1 className="font-serif font-normal text-[28px] leading-tight text-[var(--tx)]">
        {clawGreeting(name)}
      </h1>
      <span
        role="status"
        aria-label={`Claw status: ${pill.label}`}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium mt-1.5",
          pillBg[pill.tone],
        )}
      >
        <span className={cn("w-[7px] h-[7px] rounded-full flex-shrink-0", pillDot[pill.tone])} aria-hidden="true" />
        {pill.label}
      </span>
    </header>
  )
}
