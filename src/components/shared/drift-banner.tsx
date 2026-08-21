import type { ReactNode } from "react"
import { AlertBanner } from "@/components/ui/alert-banner"

export const DRIFT_BANNER_HEADLINE = "Configuration changed since last deploy - redeploy to apply"

export function formatChangedAreas(areas: string[]): string {
  if (areas.length === 0) return "workspace configuration"
  const labels: Record<string, string> = {
    tools: "tools",
    agents: "agents",
    connections: "agent connections",
    channels: "channels",
    keys: "API keys",
    workspace: "workspace settings",
  }
  return areas.map((area) => labels[area] ?? area).join(", ")
}

interface DriftBannerProps {
  changedAreas: string[]
  actions?: ReactNode
}

export function DriftBanner({ changedAreas, actions }: DriftBannerProps) {
  return (
    <AlertBanner variant="warning" actions={actions}>
      <p className="font-medium">{DRIFT_BANNER_HEADLINE}</p>
      <p className="mt-0.5 opacity-80">Changed: {formatChangedAreas(changedAreas)}</p>
    </AlertBanner>
  )
}
