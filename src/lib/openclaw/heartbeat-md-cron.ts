/**
 * HEARTBEAT.md window sections → OpenClaw cron/jobs.json entries.
 *
 * INFRA-4: machine windows are `## window <cron expr>` headings. Each
 * heading is a multi-step script. Cron payload names that heading so the
 * agent can open the matching section (sections are addressable by time).
 *
 * Legacy `- cron: "<expr>"` lines still extract when no window headings
 * exist (older fixtures / editor-only MD).
 *
 * OpenClaw load contract (upstream cron/persisted-shape.ts - quoted in
 * generator HeartbeatCronJob): jobs missing `id` are dropped ("missing-id");
 * `sessionTarget:"main"` + `payload.kind:"agentTurn"` is rejected at fire.
 */

export type HeartbeatWindowScript = {
  cron: string
  steps: string[]
  deliverable: string
}

export function heartbeatWindowHeading(expr: string): string {
  return `## window ${expr.trim()}`
}

/** Payload the runtime actually sends. Window-addressable when expr is known. */
export function heartbeatPayloadMessage(expr?: string): string {
  const tail = "If nothing needs attention, reply HEARTBEAT_OK."
  const trimmed = expr?.trim() ?? ""
  if (trimmed.length > 0) {
    return (
      `Heartbeat. Read HEARTBEAT.md section "${heartbeatWindowHeading(trimmed)}" ` +
      `and follow it strictly. ${tail}`
    )
  }
  return `Heartbeat. Read HEARTBEAT.md and follow it strictly. ${tail}`
}

export function extractWindowExprsFromHeartbeatMd(text: string): string[] {
  const found: string[] = []
  for (const match of text.matchAll(/^## window[ \t]+(.+?)\s*$/gm)) {
    const expr = match[1]?.trim()
    if (expr) found.push(expr)
  }
  return found
}

export function extractCronExprsFromHeartbeatMd(text: string): string[] {
  const windows = extractWindowExprsFromHeartbeatMd(text)
  if (windows.length > 0) return [...new Set(windows)]
  return [...text.matchAll(/cron:\s*"([^"]+)"/g)]
    .map((m) => m[1])
    .filter((e): e is string => typeof e === "string" && e.length > 0)
}

export function parseHeartbeatWindowScripts(text: string): HeartbeatWindowScript[] {
  const chunks = text.split(/^## window[ \t]+/m).slice(1)
  return chunks.map((chunk) => {
    const nl = chunk.indexOf("\n")
    const cron = (nl < 0 ? chunk : chunk.slice(0, nl)).trim()
    const body = nl < 0 ? "" : chunk.slice(nl + 1)
    const steps: string[] = []
    let deliverable = ""
    for (const raw of body.split(/\r?\n/)) {
      const line = raw.trim()
      const step = line.match(/^\d+\.\s+(.+)$/)
      if (step?.[1]) {
        steps.push(step[1])
        continue
      }
      const named = line.match(/^Deliverable:\s+(.+)$/i)
      if (named?.[1]) deliverable = named[1].trim()
    }
    return { cron, steps, deliverable }
  })
}

/** Stable id fragment from a cron expr (filesystem-/id-safe). */
export function cronExprToIdSlug(expr: string): string {
  return expr
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 48) || "cron"
}

export type HeartbeatMdCronJob = {
  id: string
  name: string
  description: string
  enabled: boolean
  deleteAfterRun: boolean
  schedule: { kind: "cron"; expr: string; tz?: string }
  agentId: string
  sessionTarget: string
  wakeMode: "now"
  payload: { kind: "agentTurn"; message: string }
}

/**
 * Build OpenClaw-valid cron jobs from HEARTBEAT.md window headings
 * (or legacy cron: lines). Dedupes identical exprs. Empty / no-cron MD → [].
 */
export function buildCronJobsFromHeartbeatMd(args: {
  heartbeatMd: string | null | undefined
  orchestratorAgentSlug: string
  timezone: string | null | undefined
}): HeartbeatMdCronJob[] {
  const exprs = extractCronExprsFromHeartbeatMd(args.heartbeatMd ?? "")
  const unique = [...new Set(exprs)]
  const tz =
    args.timezone && args.timezone.trim().length > 0
      ? args.timezone.trim()
      : undefined
  const slug = args.orchestratorAgentSlug

  return unique.map((expr) => {
    const idSlug = cronExprToIdSlug(expr)
    return {
      id: `heartbeat-${slug}-md-${idSlug}`,
      // Prefix must match claws-activity-reporter HEARTBEAT_CRON_NAME_PREFIX.
      name: `orchestrator-heartbeat-md-${idSlug}`,
      description: `Orchestrator heartbeat (from HEARTBEAT.md schedule: ${expr})`,
      enabled: true,
      deleteAfterRun: false,
      schedule: {
        kind: "cron" as const,
        expr,
        ...(tz ? { tz } : {}),
      },
      agentId: slug,
      sessionTarget: `session:agent:${slug}:main`,
      wakeMode: "now" as const,
      payload: {
        kind: "agentTurn" as const,
        message: heartbeatPayloadMessage(expr),
      },
    }
  })
}
