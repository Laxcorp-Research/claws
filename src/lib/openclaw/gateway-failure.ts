const FAILURE_MARKERS = ["Invalid config", "Gateway failed"] as const

/** First boot or upgrade line the dashboard should show. */
export function gatewayFailureHeadline(text: string | null | undefined): string | null {
  if (!text) return null
  const attribution = text.match(/Proxy client attribution is required\.[^"\\]*/)
  if (attribution) return attribution[0]
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.toLowerCase().includes("origin not allowed")) return trimmed
    if (
      trimmed.includes("proxy-shaped traffic") ||
      trimmed.includes("Gateway-authenticated routes reject")
    ) {
      return trimmed
    }
    if (FAILURE_MARKERS.some((marker) => trimmed.includes(marker))) return trimmed
  }
  return null
}

/** Last `count` log lines, kept as Deployment.errorMessage. */
export function lastLogLines(text: string, count = 50): string {
  const lines = text.split(/\r?\n/)
  return lines.slice(Math.max(0, lines.length - count)).join("\n").trim()
}
