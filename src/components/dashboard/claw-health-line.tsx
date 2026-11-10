"use client"

import type { ReactNode } from "react"
import { AlertBanner } from "@/components/ui/alert-banner"

export type ClawHealthNudge = {
  id: string
  variant: "error" | "warning" | "info"
  icon?: ReactNode
  message: ReactNode
  cta?: ReactNode
}

export function formatClawHealthHistory(recoveredThisWeek: number): string {
  if (recoveredThisWeek <= 0) return "Claw health: all clear"
  return `Claw health: auto-recovered \u00d7${recoveredThisWeek} this week`
}

/**
 * Banner stack collapsed into one line: healed history plus at most one
 * active nudge. MUTATION: restoring AlertStack multi-banner without this
 * line fails the dashboard contract test.
 */
export function ClawHealthLine(props: {
  recoveredThisWeek: number
  nudge: ClawHealthNudge | null
}) {
  return (
    <div className="mb-[14px]" data-claw-health>
      <p className="text-[12px] font-medium text-[var(--tx2)] mb-[8px]">
        {formatClawHealthHistory(props.recoveredThisWeek)}
      </p>
      {props.nudge ? (
        <AlertBanner
          id={props.nudge.id === "container-error" ? "claw-error" : undefined}
          variant={props.nudge.variant}
          icon={props.nudge.icon}
          actions={props.nudge.cta}
        >
          {props.nudge.message}
        </AlertBanner>
      ) : null}
    </div>
  )
}
