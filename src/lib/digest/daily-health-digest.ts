/**
 * Morning health digest — 5-line table from ActivityLog receipts (not prose).
 * Sent via Telegram using the same Bot API path as critical alerts.
 */

export const DAILY_DIGEST_EVENT_KIND = "daily_digest_sent"

export type DigestWindowStats = {
  heartbeatsKept: number
  heartbeatsMissedLedgered: number
  sleepWakeCycles: number
  costCents24h: number
  strands: number
  errors24h: number
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
  return [
    `Claws digest — ${args.workspaceName}`,
    `As of ${args.asOfUtc} (UTC, last 24h)`,
    `Heartbeats: kept ${s.heartbeatsKept} | missed+ledgered ${s.heartbeatsMissedLedgered}`,
    `Sleep/wake cycles: ${s.sleepWakeCycles}`,
    `Costs: ${cost}`,
    `Strands: ${s.strands}`,
    `Errors: ${s.errors24h}`,
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
  strandOpen: boolean
}): DigestWindowStats {
  let heartbeatsKept = 0
  let heartbeatsMissedLedgered = 0
  let sleepWakeCycles = 0
  let errors24h = 0

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
    }
  }

  return {
    heartbeatsKept,
    heartbeatsMissedLedgered,
    sleepWakeCycles,
    costCents24h: args.costCents24h,
    strands: args.strandOpen ? 1 : 0,
    errors24h,
  }
}
