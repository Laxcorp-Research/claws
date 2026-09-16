/**
 * Morning health digest - table from ActivityLog receipts (not prose).
 * Telegram when connected; owner email otherwise (Resend id ledgered).
 *
 * DIGEST HONESTY (v2): the old digest ended in a bare
 * "Errors: N agent · M external" - count without content. v2 names every
 * error class in plain language and routes it to one of three sections:
 * "Needs you" (user-only, ONE action + link, deduped against nudges
 * already sent), "Handled automatically" (degraded, mission completed),
 * "Transient, recovered" (not counted as errors). Kept/missed heartbeats,
 * cycles and cost stay. MUTATION: a count-only digest (sections dropped)
 * fails the section-header snapshot tests.
 */

import {
  aggregateDigestErrorClasses,
  DIGEST_SECTION_HEADERS,
  isCountedDigestError,
  type AggregatableErrorRow,
  type DigestErrorClassAgg,
  type DigestSection,
} from "@/lib/digest/error-classes"

export const DAILY_DIGEST_EVENT_KIND = "daily_digest_sent"

/** Digest format version stamped into the ledger metadata. */
export const DAILY_DIGEST_FORMAT_VERSION = 2

/** External HTTP-class tools - counted separately from agent faults. */
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
  /** v2: ERROR rows minus transient classes - the honest headline count. */
  errorsCounted24h: number
  /** v2: named classes with count + first/last time, section-ordered. */
  errorClasses: DigestErrorClassAgg[]
}

/**
 * Legacy agent/external split (kept for ledger stat continuity).
 * v2 fix: membership is EXACT - the old `includes("fetch")` heuristic
 * counted dir_fetch / file_fetch (LOCAL file tools) as "external", which
 * is how the canary's Sep-15 digest called a local directory fumble an
 * external error. MUTATION: treating web_fetch as agent → Day-1 4/1 split fails.
 */
export function classifyDigestError(metadata: string | null): "external" | "agent" {
  if (!metadata) return "agent"
  try {
    const parsed = JSON.parse(metadata) as { toolName?: unknown }
    const tool =
      typeof parsed.toolName === "string" ? parsed.toolName.toLowerCase() : ""
    if (tool && EXTERNAL_TOOL_NAMES.has(tool)) return "external"
  } catch {
    /* non-JSON metadata → agent */
  }
  return "agent"
}

export type OpenNudgeLine = {
  condition: string
  /** The ONE action the user should take (customer-nudge copy). */
  action: string
  /** When the nudge was last delivered - renders "reminded Sep 9". */
  remindedAt: Date | string | null
}

/** "Sep 9" (UTC) for nudge-dedup lines. */
export function formatRemindedLabel(value: Date | string | null): string | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return null
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  return `${months[d.getUTCMonth()]} ${d.getUTCDate()}`
}

function classLine(agg: DigestErrorClassAgg, activityBaseUrl: string | null): string {
  const times =
    agg.firstAtUtc && agg.lastAtUtc
      ? agg.firstAtUtc === agg.lastAtUtc
        ? `, at ${agg.firstAtUtc}`
        : `, ${agg.firstAtUtc}-${agg.lastAtUtc}`
      : ""
  const link = activityBaseUrl
    ? ` -> ${activityBaseUrl}&aq=${encodeURIComponent(agg.activityQuery)}`
    : ""
  return `- ${agg.label} - ${agg.count}x${times}${link}`
}

function sectionBlock(args: {
  section: DigestSection
  classes: DigestErrorClassAgg[]
  extraLines?: string[]
  activityBaseUrl: string | null
}): string[] {
  const lines: string[] = [DIGEST_SECTION_HEADERS[args.section]]
  for (const extra of args.extraLines ?? []) lines.push(extra)
  for (const agg of args.classes.filter((c) => c.section === args.section)) {
    lines.push(classLine(agg, args.activityBaseUrl))
  }
  if (lines.length === 1) lines.push("- nothing")
  return lines
}

/** Pure formatter - mutation: drop a line or a section header → tests fail. */
export function formatDailyDigestMessage(args: {
  workspaceName: string
  asOfUtc: string
  stats: DigestWindowStats
  /** Open user-only conditions (nudge already sent, unresolved) - deduped as "reminded <date>". */
  openNudges?: OpenNudgeLine[]
  /** e.g. https://staging.app.buildclaws.ai - link base for dashboard/activity deep links. */
  appUrl?: string | null
  workspaceId?: string | null
}): string {
  const s = args.stats
  const cost =
    s.costCents24h <= 0
      ? "$0.00"
      : `$${(s.costCents24h / 100).toFixed(2)}`
  const costLabel = s.costIsEstimate ? "Costs (est.)" : "Costs"

  const base =
    args.appUrl && args.workspaceId
      ? `${args.appUrl.replace(/\/$/, "")}/dashboard/${args.workspaceId}`
      : null
  const activityBaseUrl = base ? `${base}?tab=activity` : null

  const nudgeLines = (args.openNudges ?? []).map((n) => {
    const reminded = formatRemindedLabel(n.remindedAt)
    const dedup = reminded ? `; reminded ${reminded}` : ""
    const link = base ? ` -> ${base}` : ""
    return `- ${n.action} (${n.condition}${dedup})${link}`
  })

  const transientCount = s.errorClasses
    .filter((c) => !isCountedDigestError(c.classId))
    .reduce((sum, c) => sum + c.count, 0)

  return [
    `Claws digest - ${args.workspaceName}`,
    `As of ${args.asOfUtc} (UTC, last 24h)`,
    `Heartbeats: kept ${s.heartbeatsKept} | missed+ledgered ${s.heartbeatsMissedLedgered}`,
    `Sleep/wake cycles: ${s.sleepWakeCycles}`,
    `${costLabel}: ${cost}`,
    `Strands: ${s.strands}`,
    `Errors that count: ${s.errorsCounted24h} (${s.errors24h} ledgered; ${transientCount} transient recoveries excluded)`,
    "",
    ...sectionBlock({
      section: "needs_you",
      classes: s.errorClasses,
      extraLines: nudgeLines,
      activityBaseUrl,
    }),
    "",
    ...sectionBlock({ section: "handled", classes: s.errorClasses, activityBaseUrl }),
    "",
    ...sectionBlock({ section: "transient", classes: s.errorClasses, activityBaseUrl }),
  ].join("\n")
}

export function formatDailyDigestEmailHtml(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
  return `<pre style="font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;font-size:14px;white-space:pre-wrap;margin:0;">${escaped}</pre>`
}

export type DigestActivityRow = {
  actionType: string
  action: string
  metadata: string | null
  /** v2: full error text for classification (optional - older callers). */
  detail?: string | null
  /** v2: row time for first/last labels (optional - older callers). */
  timestamp?: Date | string | null
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
  const errorRows: AggregatableErrorRow[] = []

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
      // Interval polls are not cron-window "kept" beats - skip for kept count.
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
    // Counts hibernate + wake-ack ledger rows (not paired units). Missing
    // hibernation_complete ledgers made real naps report cycles=0.
    if (
      /Hibernat/i.test(row.action) ||
      meta.includes("hibernation") ||
      meta.includes('"eventKind":"hibernation_complete"') ||
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
      errorRows.push({
        action: row.action,
        detail: row.detail ?? null,
        metadata: row.metadata,
        timestamp: row.timestamp ?? null,
      })
    }
  }

  const errorClasses = aggregateDigestErrorClasses(errorRows)
  const errorsCounted24h = errorClasses
    .filter((c) => isCountedDigestError(c.classId))
    .reduce((sum, c) => sum + c.count, 0)

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
    errorsCounted24h,
    errorClasses,
  }
}

/** UTC calendar-day start for idempotency (same-day skip). */
export function utcDigestDayStart(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0),
  )
}
