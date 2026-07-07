"use client"

import { useMemo, useState, type ReactNode } from "react"
import { AlertBanner } from "@/components/ui/alert-banner"

export interface AlertStackItem {
  id: string
  priority: number
  variant: "error" | "warning" | "info"
  icon?: ReactNode
  message: ReactNode
  sub?: ReactNode
  cta?: ReactNode
}

interface AlertStackProps {
  alerts: AlertStackItem[]
}

function renderAlert(alert: AlertStackItem) {
  return (
    <AlertBanner key={alert.id} variant={alert.variant} icon={alert.icon} actions={alert.cta}>
      <div>
        <div>{alert.message}</div>
        {alert.sub && <div className="mt-0.5 opacity-80">{alert.sub}</div>}
      </div>
    </AlertBanner>
  )
}

export function AlertStack({ alerts }: AlertStackProps) {
  const [expanded, setExpanded] = useState(false)
  const ordered = useMemo(() => [...alerts].sort((a, b) => a.priority - b.priority), [alerts])
  const [primary, ...rest] = ordered

  if (!primary) return null

  return (
    <div className="mb-[14px]">
      {renderAlert(primary)}
      {rest.length > 0 && (
        <>
          <button
            type="button"
            className="mt-[-6px] mb-[10px] text-[11px] font-medium text-[var(--ac-text)] hover:underline"
            aria-expanded={expanded}
            onClick={() => setExpanded((v) => !v)}
          >
            {rest.length} more alert{rest.length === 1 ? "" : "s"}
          </button>
          {expanded && <div>{rest.map(renderAlert)}</div>}
        </>
      )}
    </div>
  )
}
