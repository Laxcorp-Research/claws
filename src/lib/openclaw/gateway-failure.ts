const FAILURE_MARKERS = ["Invalid config", "Gateway failed"] as const

/** First boot line the dashboard should show. Null when the log has neither marker. */
export function gatewayFailureHeadline(text: string | null | undefined): string | null {
  if (!text) return null
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (FAILURE_MARKERS.some((marker) => trimmed.includes(marker))) return trimmed
  }
  return null
}

/** Last `count` log lines, kept as Deployment.errorMessage. */
export function lastLogLines(text: string, count = 50): string {
  const lines = text.split(/\r?\n/)
  return lines.slice(Math.max(0, lines.length - count)).join("\n").trim()
}
