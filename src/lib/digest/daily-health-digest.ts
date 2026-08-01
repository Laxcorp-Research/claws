/**
 * Morning health digest — table from ActivityLog receipts (not prose).
 * Sent via Telegram using the same Bot API path as critical alerts.
 */

export const DAILY_DIGEST_EVENT_KIND = "daily_digest_sent"

/** External HTTP-class tools — counted separately from agent faults. */
const EXTERNAL_TOOL_NAMES = new Set([
  "web_fetch",
  "http",
  "fetch",
  "browser",
  "web_search",
])

export type DigestWindowStats = {
  heartbeatsKept: number
  heartbeatsMissedLedgered: number
  sleepWakeCycles: number
  costCents24h: number
  /** When true, formatter labels the cost line "Costs (est.)". */
  costIsEstimate: boolean
  strands: number
  /** Raw ERROR row total (ledger). */
  errors24h: number
  errorsAgent24h: number
  errorsExternal24h: number
}

/**
 * Classify an ERROR row: web_fetch / http-class → external; else agent.
 * MUTATION: treating web_fetch as agent → Day-1 4/1 split fails.
 */
export function classifyDigestError(metadata: string | null): "external" | "agent" {
  if (!metadata) return "agent"
  try {
    const parsed = JSON.parse(metadata) as { toolName?: unknown }
    const tool =
      typeof parsed.toolName === "string" ? parsed.toolName.toLowerCase() : ""
    if (tool && EXTERNAL_TOOL_NAMES.has(tool)) return "external"
    if (tool.includes("fetch") || tool.includes("http")) return "external"
  } catch {
    /* non-JSON metadata → agent */
  }
  return "agent"
}

/** Pure formatter — mutation: drop a line → snapshot test fails. */
export function formatDailyDigestMessage(args: {
  workspaceName: string
  asOfUtc: string
  stats: DigestWindowStats
}): string {
  const s = args.stats
  const cost =
    s.costCents24h <= 0
      ? "$0.00"
      : `$${(s.costCents24h / 100).toFixed(2)}`
  const costLabel = s.costIsEstimate ? "Costs (est.)" : "Costs"
  return [
    `Claws digest — ${args.workspaceName}`,
    `As of ${args.asOfUtc} (UTC, last 24h)`,
    `Heartbeats: kept ${s.heartbeatsKept} | missed+ledgered ${s.heartbeatsMissedLedgered}`,
    `Sleep/wake cycles: ${s.sleepWakeCycles}`,
    `${costLabel}: ${cost}`,
    `Strands: ${s.strands}`,
    `Errors: ${s.errorsAgent24h} agent · ${s.errorsExternal24h} external`,
  ].join("\n")
}

export type DigestActivityRow = {
  actionType: string
  action: string
  metadata: string | null
}

/**
 * Derive digest counters from ActivityLog rows in the window + cost sum.
 * Heartbeat kept = typed HEARTBEAT ("Heartbeat tick") OR poll-marker TASK_START.
 */
export function computeDigestStats(args: {
  rows: DigestActivityRow[]
  costCents24h: number
  costIsEstimate?: boolean
  strandOpen: boolean
}): DigestWindowStats {
  let heartbeatsKept = 0
  let heartbeatsMissedLedgered = 0
  let sleepWakeCycles = 0
  let errors24h = 0
  let errorsAgent24h = 0
  let errorsExternal24h = 0

  for (const row of args.rows) {
    if (row.actionType === "HEARTBEAT" && /Heartbeat tick/i.test(row.action)) {
      heartbeatsKept++
      continue
    }
    if (
      row.actionType === "TASK_START" &&
      (/OpenClaw heartbeat poll/i.test(row.action) ||
        /OpenClaw heartbeat poll/i.test(row.metadata ?? ""))
    ) {
      // Interval polls are not cron-window "kept" beats — skip for kept count.
      continue
    }
    if (
      row.actionType === "TASK_START" &&
      /^Heartbeat check/i.test(row.action)
    ) {
      // Pair with tick; do not double-count kept.
      continue
    }
    const meta = row.metadata ?? ""
    if (
      meta.includes('"eventKind":"heartbeat_missed"') ||
      meta.includes('"eventKind":"heartbeat_late_wake"')
    ) {
      heartbeatsMissedLedgered++
    }
    if (
      /Hibernat/i.test(row.action) ||
      meta.includes("hibernation") ||
      meta.includes('"eventKind":"wake_ack_sent"')
    ) {
      sleepWakeCycles++
    }
    if (row.actionType === "ERROR") {
      errors24h++
      if (classifyDigestError(row.metadata) === "external") {
        errorsExternal24h++
      } else {
        errorsAgent24h++
      }
    }
  }

  return {
    heartbeatsKept,
    heartbeatsMissedLedgered,
    sleepWakeCycles,
    costCents24h: args.costCents24h,
    costIsEstimate: args.costIsEstimate ?? false,
    strands: args.strandOpen ? 1 : 0,
    errors24h,
    errorsAgent24h,
    errorsExternal24h,
  }
}

/** UTC calendar-day start for idempotency (same-day skip). */
export function utcDigestDayStart(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
  )
}
