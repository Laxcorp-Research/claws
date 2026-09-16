/**
 * DIGEST HONESTY - the count-without-content fix.
 *
 * Every ERROR row is assigned a named class in plain language, and every
 * class routes to exactly one digest section:
 *
 *   needs_you  - only the user can fix it (dead credentials). ONE action + link.
 *   handled    - something degraded but the mission still completed.
 *   transient  - internal control flow / agent retries that recovered.
 *                NOT counted as errors in the digest headline.
 *
 * Canary trace that seeded these classes (prod cms1i48ta..., window
 * 2026-09-14T06:00Z -> 09-15T06:00Z, the "9 agent / 5 external" digest):
 *   8x "Heartbeat catch-up skipped: beyond-grace" (routine wake control flow
 *      ledgered as ERROR - every 4h wake, beat still fired),
 *   4x "Tool web_fetch failed" (520 / 404 / empty extraction - scout used
 *      other sources, mission completed),
 *   1x "Tool read failed: EISDIR" + 1x "Tool dir_fetch failed: unknown
 *      node" (agent retried, recovered). The old classifier's
 *      `includes("fetch")` heuristic counted dir_fetch (a LOCAL file tool)
 *      as "external" - that heuristic is gone.
 * 9.4 staging adds "Tool agents_wait failed: {" / sessions_yield storms
 * (upstream transient - agent-loop retry recovers; see ingest reclass).
 */

export type DigestSection = "needs_you" | "handled" | "transient"

export type DigestErrorClassId =
  | "tool-auth-dead"
  | "web-fetch-failed"
  | "catchup-skip"
  | "session-plumbing"
  | "file-tool-fumble"
  | "other-agent"

export type DigestErrorClassSpec = {
  section: DigestSection
  /** Plain-language digest line. */
  label: string
  /** Search string for the Activity deep link (?tab=activity&aq=...). */
  activityQuery: string
}

export const DIGEST_ERROR_CLASSES: Record<DigestErrorClassId, DigestErrorClassSpec> = {
  "tool-auth-dead": {
    section: "needs_you",
    label: "A connected tool is rejecting its credentials (401/unauthorized)",
    activityQuery: "401",
  },
  "web-fetch-failed": {
    section: "handled",
    label: "External pages failed to load (dead links, 4xx/5xx); the agent used other sources",
    activityQuery: "Tool web_fetch failed",
  },
  "catchup-skip": {
    section: "transient",
    label: "Wake-time heartbeat catch-up declined stale windows (routine; no beat was lost)",
    activityQuery: "Heartbeat catch-up skipped",
  },
  "session-plumbing": {
    section: "transient",
    label: "Agent coordination calls (agents_wait / sessions_yield) hiccuped and the agent retried",
    activityQuery: "agents_wait",
  },
  "file-tool-fumble": {
    section: "transient",
    label: "Agent file lookups hit a wrong path and retried (EISDIR / ENOENT / unknown node)",
    activityQuery: "Tool read failed",
  },
  "other-agent": {
    section: "handled",
    label: "Other agent errors (open Activity for the full detail)",
    activityQuery: "failed",
  },
}

/** Section order + headers for the rendered digest. */
export const DIGEST_SECTION_HEADERS: Record<DigestSection, string> = {
  needs_you: "Needs you:",
  handled: "Handled automatically (mission continued):",
  transient: "Transient, recovered (not counted as errors):",
}

const EXTERNAL_HTTP_TOOLS = new Set(["web_fetch", "http", "fetch", "browser", "web_search"])
const LOCAL_FILE_TOOLS = new Set(["read", "write", "edit", "ls", "glob", "dir_fetch", "file_fetch"])
const SESSION_PLUMBING_TOOLS = new Set(["agents_wait", "sessions_yield", "sessions_wait", "agents_yield"])

const AUTH_DEAD_RE = /\b401\b|unauthorized|invalid[ _-]?(?:bearer|token|credentials)|expired[ _-]?token/i
const FILE_FUMBLE_RE = /\bEISDIR\b|\bENOENT\b|unknown node/i

export type ClassifiableErrorRow = {
  action: string
  detail?: string | null
  metadata?: string | null
}

function metadataToolName(metadata: string | null | undefined): string {
  if (!metadata) return ""
  try {
    const parsed = JSON.parse(metadata) as { toolName?: unknown }
    return typeof parsed.toolName === "string" ? parsed.toolName.toLowerCase() : ""
  } catch {
    return ""
  }
}

function metadataEventKind(metadata: string | null | undefined): string {
  if (!metadata) return ""
  try {
    const parsed = JSON.parse(metadata) as { eventKind?: unknown }
    return typeof parsed.eventKind === "string" ? parsed.eventKind : ""
  } catch {
    return ""
  }
}

/**
 * Row -> named class. Order matters: catch-up and session-plumbing are
 * structural (metadata/tool identity); auth-dead beats generic fetch
 * failures so a dead Bearer never hides inside "external pages failed".
 */
export function classifyDigestErrorRow(row: ClassifiableErrorRow): DigestErrorClassId {
  const tool = metadataToolName(row.metadata)
  const kind = metadataEventKind(row.metadata)
  const text = `${row.action}\n${row.detail ?? ""}`

  if (kind === "heartbeat_catchup_skip" || /^Heartbeat catch-up skipped/i.test(row.action)) {
    return "catchup-skip"
  }
  if (
    SESSION_PLUMBING_TOOLS.has(tool) ||
    /^Tool (?:agents_wait|sessions_yield|sessions_wait|agents_yield) failed/i.test(row.action)
  ) {
    return "session-plumbing"
  }
  if (AUTH_DEAD_RE.test(text)) return "tool-auth-dead"
  if (EXTERNAL_HTTP_TOOLS.has(tool) || /^Tool (?:web_fetch|http) failed/i.test(row.action)) {
    return "web-fetch-failed"
  }
  if (LOCAL_FILE_TOOLS.has(tool) || FILE_FUMBLE_RE.test(text)) return "file-tool-fumble"
  return "other-agent"
}

export function digestSectionForClass(classId: DigestErrorClassId): DigestSection {
  return DIGEST_ERROR_CLASSES[classId].section
}

/** Transient classes are NOT counted in the digest's error headline. */
export function isCountedDigestError(classId: DigestErrorClassId): boolean {
  return DIGEST_ERROR_CLASSES[classId].section !== "transient"
}

export type DigestErrorClassAgg = {
  classId: DigestErrorClassId
  section: DigestSection
  label: string
  activityQuery: string
  count: number
  firstAtUtc: string | null
  lastAtUtc: string | null
}

export type AggregatableErrorRow = ClassifiableErrorRow & {
  timestamp?: Date | string | null
}

function toUtcLabel(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(11, 16) + "Z"
}

const SECTION_ORDER: DigestSection[] = ["needs_you", "handled", "transient"]

/** ERROR rows -> per-class aggregates (count, first/last time), section-ordered. */
export function aggregateDigestErrorClasses(rows: AggregatableErrorRow[]): DigestErrorClassAgg[] {
  const byClass = new Map<DigestErrorClassId, { count: number; first: string | null; last: string | null }>()
  for (const row of rows) {
    const classId = classifyDigestErrorRow(row)
    const at = toUtcLabel(row.timestamp)
    const agg = byClass.get(classId) ?? { count: 0, first: null, last: null }
    agg.count++
    if (at) {
      if (!agg.first) agg.first = at
      agg.last = at
    }
    byClass.set(classId, agg)
  }
  const out: DigestErrorClassAgg[] = []
  for (const [classId, agg] of byClass) {
    const spec = DIGEST_ERROR_CLASSES[classId]
    out.push({
      classId,
      section: spec.section,
      label: spec.label,
      activityQuery: spec.activityQuery,
      count: agg.count,
      firstAtUtc: agg.first,
      lastAtUtc: agg.last,
    })
  }
  out.sort(
    (a, b) =>
      SECTION_ORDER.indexOf(a.section) - SECTION_ORDER.indexOf(b.section) || b.count - a.count,
  )
  return out
}

// ─── Ingest-time reclassification (activity wire) ──────────────────────────
//
// The container overlay cannot post SYSTEM rows (the wire allowlist rejects
// them so a leaked secret can't forge control-plane rows), and 5.22 images
// in the field keep ledgering routine control flow as ERROR. The trusted
// ingest route therefore reclassifies KNOWN-transient ERROR events to SYSTEM
// at write time - both runtime lines get honest ledgers with no image
// rebuild.

export const TOOL_TRANSIENT_RECOVERED_EVENT_KIND = "tool_transient_recovered"

/** Catch-up skip reasons that are routine control flow, not faults. */
const ROUTINE_CATCHUP_REASONS = new Set(["beyond-grace", "no-due-job", "disabled"])

export type IngestReclassDecision = {
  storeActionType: "SYSTEM"
  transientClass: Extract<DigestErrorClassId, "catchup-skip" | "session-plumbing">
} | null

export function decideIngestErrorReclass(args: {
  type: string
  action: string
  detail?: string | null
  metadata: Record<string, unknown>
}): IngestReclassDecision {
  if (args.type !== "ERROR") return null
  const kind = typeof args.metadata.eventKind === "string" ? args.metadata.eventKind : ""
  if (kind === "heartbeat_catchup_skip") {
    const reason = typeof args.metadata.reason === "string" ? args.metadata.reason : ""
    if (ROUTINE_CATCHUP_REASONS.has(reason)) {
      return { storeActionType: "SYSTEM", transientClass: "catchup-skip" }
    }
    return null // gateway-unhealthy / rpc-fail / cron-parser-unavailable stay ERROR
  }
  const toolName =
    typeof args.metadata.toolName === "string" ? args.metadata.toolName.toLowerCase() : ""
  if (
    SESSION_PLUMBING_TOOLS.has(toolName) ||
    /^Tool (?:agents_wait|sessions_yield|sessions_wait|agents_yield) failed/i.test(args.action)
  ) {
    return { storeActionType: "SYSTEM", transientClass: "session-plumbing" }
  }
  return null
}

/** Storm gate: N-th session-plumbing transient within the window pages the owner. */
export const TRANSIENT_STORM_WINDOW_MS = 15 * 60 * 1000
export const TRANSIENT_STORM_THRESHOLD = 6

export function decideTransientStormAlert(args: { recentTransientCount: number }): boolean {
  return args.recentTransientCount >= TRANSIENT_STORM_THRESHOLD
}
