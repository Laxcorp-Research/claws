/**
 * HEARTBEAT.md cron-line → OpenClaw cron/jobs.json entries.
 *
 * Templates (e.g. Twitter/X Growth Machine) store wall-clock schedules as
 * prose checklist lines (`- cron: "0 8 * * *"`). Those lines are NOT consumed
 * by the OpenClaw -9 cron store - only `cron/jobs.json` (and
 * `agents.defaults.heartbeat.every` for intervals) are. This module turns
 * MD schedule lines into the verified persisted job shape so generator +
 * backfill share one source of machine truth. HEARTBEAT.md itself stays prose.
 *
 * OpenClaw load contract (upstream cron/persisted-shape.ts - quoted in
 * generator HeartbeatCronJob): jobs missing `id` are dropped ("missing-id");
 * `sessionTarget:"main"` + `payload.kind:"agentTurn"` is rejected at fire.
 */

export function extractCronExprsFromHeartbeatMd(text: string): string[] {
  return [...text.matchAll(/cron:\s*"([^"]+)"/g)]
    .map((m) => m[1])
    .filter((e): e is string => typeof e === "string" && e.length > 0)
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
 * Build OpenClaw-valid cron jobs from HEARTBEAT.md schedule lines.
 * Dedupes identical exprs. Empty / no-cron MD → [].
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
        message:
          "Heartbeat. Read HEARTBEAT.md and follow it strictly. " +
          "If nothing needs attention, reply HEARTBEAT_OK.",
      },
    }
  })
}
