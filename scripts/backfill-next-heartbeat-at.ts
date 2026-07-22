/**
 * scripts/backfill-next-heartbeat-at.ts
 *
 * Lifecycle P2.2 — re-derive ContainerState heartbeat columns + nextHeartbeatAt
 * from the workspace's orchestrator schedule (Builder frequency/time OR
 * HEARTBEAT.md cron lines on the Agent row / template install). Single source
 * with the generator — NOT from gzip snapshot HEARTBEAT.md (removed #337
 * hydrate; that bandaid wrote cols the generator never emitted).
 *
 * USAGE
 *   Dry-run (DEFAULT):
 *     npx dotenv -e .env.staging -- npx tsx scripts/backfill-next-heartbeat-at.ts
 *   Apply:
 *     CONFIRM_BACKFILL=yes npx dotenv -e .env.staging -- npx tsx scripts/backfill-next-heartbeat-at.ts
 *
 * SAFETY
 *   - Defaults to DRY-RUN.
 *   - Idempotent: same wall clock → same hint; already-armed rows skipped.
 */
import { pathToFileURL } from "node:url"
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import {
  computeNextHeartbeatAt,
  parseHeartbeatEveryToMs,
} from "../src/lib/hibernation/next-heartbeat"
import { resolveHeartbeatSchedule, toAgentId } from "../src/lib/openclaw/generator"

export interface BackfillRow {
  workspaceId: string
  workspaceStatus: string
  workspaceName: string
  priorNextHeartbeatAt: Date | null
  nextHeartbeatAt: Date | null
  scheduleSource: "db" | "agent-schedule" | "none"
  hydratedCronExpressions?: string
  hydratedIntervalMs?: number | null
  skippedReason?: string
}

export interface BackfillResult {
  mode: "dry-run" | "applied"
  now: Date
  rows: BackfillRow[]
  updated: number
  skipped: number
}

export type BackfillOrchestrator = {
  name: string
  agentSlug: string | null
  heartbeatFrequency: string | null
  heartbeatTime: string | null
  heartbeatMd: string | null
}

export type BackfillStateRow = {
  workspaceId: string
  nextHeartbeatAt: Date | null
  heartbeatCronExpressions: string | null
  heartbeatInterval: number | null
  workspace: {
    status: string
    name: string
    timezone: string | null
    agents: BackfillOrchestrator[]
  }
}

/** Narrow DB surface so unit tests can inject a stub without full Prisma delegates. */
export interface BackfillDb {
  containerState: {
    findMany: (args: {
      where?: unknown
      select: unknown
    }) => Promise<BackfillStateRow[]>
    update: (args: {
      where: { workspaceId: string }
      data: {
        nextHeartbeatAt: Date
        heartbeatCronExpressions?: string | null
        heartbeatInterval?: number | null
      }
    }) => Promise<unknown>
  }
}

function hasDbCron(cron: string | null | undefined): boolean {
  return typeof cron === "string" && cron.length > 0 && cron !== "[]"
}

function hasDbInterval(interval: number | null | undefined): boolean {
  return typeof interval === "number" && Number.isFinite(interval) && interval > 0
}

/**
 * Derive cron JSON + interval ms from orchestrator Agent schedule fields.
 * Same resolver the generator uses at deploy time.
 */
export function deriveScheduleFromOrchestrator(args: {
  orchestrator: BackfillOrchestrator | undefined
  timezone: string | null
}): {
  cronJson: string | null
  intervalMs: number | null
  source: "agent-schedule" | "none"
} {
  const orch = args.orchestrator
  if (!orch) {
    return { cronJson: null, intervalMs: null, source: "none" }
  }
  const slug =
    (orch.agentSlug && orch.agentSlug.trim().length > 0
      ? orch.agentSlug.trim()
      : null) ?? toAgentId(orch.name)
  const resolved = resolveHeartbeatSchedule(
    orch.heartbeatFrequency,
    orch.heartbeatTime,
    args.timezone,
    slug,
    orch.heartbeatMd,
  )
  if (!resolved) {
    return { cronJson: null, intervalMs: null, source: "none" }
  }

  const jobs = [
    ...(resolved.cronJob ? [resolved.cronJob] : []),
    ...(resolved.mdCronJobs ?? []),
  ]
  const cronJson = jobs.length > 0 ? JSON.stringify(jobs) : null
  const intervalMs = resolved.intervalConfig?.every
    ? parseHeartbeatEveryToMs(resolved.intervalConfig.every)
    : null

  if (!cronJson && !intervalMs) {
    return { cronJson: null, intervalMs: null, source: "none" }
  }
  return { cronJson, intervalMs, source: "agent-schedule" }
}

export async function planAndMaybeApply(
  db: BackfillDb,
  opts: { confirm: boolean; now?: Date; log?: (msg: string) => void },
): Promise<BackfillResult> {
  const log = opts.log ?? console.log
  const now = opts.now ?? new Date()

  const states = await db.containerState.findMany({
    select: {
      workspaceId: true,
      nextHeartbeatAt: true,
      heartbeatCronExpressions: true,
      heartbeatInterval: true,
      workspace: {
        select: {
          status: true,
          name: true,
          timezone: true,
          agents: {
            where: { role: "ORCHESTRATOR" },
            select: {
              name: true,
              agentSlug: true,
              heartbeatFrequency: true,
              heartbeatTime: true,
              heartbeatMd: true,
            },
            take: 1,
          },
        },
      },
    },
  })

  const rows: BackfillRow[] = []
  let updated = 0
  let skipped = 0

  for (const state of states) {
    let cronExprs = state.heartbeatCronExpressions
    let intervalMs = state.heartbeatInterval
    let scheduleSource: BackfillRow["scheduleSource"] =
      hasDbCron(cronExprs) || hasDbInterval(intervalMs) ? "db" : "none"
    let hydratedCron: string | undefined
    let hydratedInterval: number | null | undefined

    if (!hasDbCron(cronExprs) && !hasDbInterval(intervalMs)) {
      const derived = deriveScheduleFromOrchestrator({
        orchestrator: state.workspace.agents[0],
        timezone: state.workspace.timezone,
      })
      if (derived.source === "agent-schedule") {
        cronExprs = derived.cronJson
        intervalMs = derived.intervalMs
        scheduleSource = "agent-schedule"
        hydratedCron = derived.cronJson ?? undefined
        hydratedInterval = derived.intervalMs
      }
    }

    if (!hasDbCron(cronExprs) && !hasDbInterval(intervalMs)) {
      skipped++
      rows.push({
        workspaceId: state.workspaceId,
        workspaceStatus: state.workspace.status,
        workspaceName: state.workspace.name,
        priorNextHeartbeatAt: state.nextHeartbeatAt,
        nextHeartbeatAt: null,
        scheduleSource: "none",
        skippedReason: "no-schedule",
      })
      continue
    }

    const nextHeartbeatAt = computeNextHeartbeatAt({
      now,
      heartbeatCronExpressions: cronExprs,
      heartbeatIntervalMs: intervalMs,
    })

    if (!nextHeartbeatAt) {
      skipped++
      rows.push({
        workspaceId: state.workspaceId,
        workspaceStatus: state.workspace.status,
        workspaceName: state.workspace.name,
        priorNextHeartbeatAt: state.nextHeartbeatAt,
        nextHeartbeatAt: null,
        scheduleSource,
        hydratedCronExpressions: hydratedCron,
        hydratedIntervalMs: hydratedInterval,
        skippedReason: "compute-null",
      })
      continue
    }

    const hintUnchanged =
      state.nextHeartbeatAt !== null &&
      state.nextHeartbeatAt.getTime() === nextHeartbeatAt.getTime()
    const needsCronPersist =
      Boolean(hydratedCron) && !hasDbCron(state.heartbeatCronExpressions)
    const needsIntervalPersist =
      hydratedInterval != null && !hasDbInterval(state.heartbeatInterval)
    const unchanged = hintUnchanged && !needsCronPersist && !needsIntervalPersist

    rows.push({
      workspaceId: state.workspaceId,
      workspaceStatus: state.workspace.status,
      workspaceName: state.workspace.name,
      priorNextHeartbeatAt: state.nextHeartbeatAt,
      nextHeartbeatAt,
      scheduleSource,
      hydratedCronExpressions: hydratedCron,
      hydratedIntervalMs: hydratedInterval,
      skippedReason: unchanged ? "already-armed" : undefined,
    })

    if (unchanged) {
      skipped++
      continue
    }

    if (opts.confirm) {
      await db.containerState.update({
        where: { workspaceId: state.workspaceId },
        data: {
          nextHeartbeatAt,
          ...(needsCronPersist && hydratedCron
            ? { heartbeatCronExpressions: hydratedCron }
            : {}),
          ...(needsIntervalPersist && hydratedInterval != null
            ? { heartbeatInterval: hydratedInterval }
            : {}),
        },
      })
    }
    updated++
  }

  const mode = opts.confirm ? "applied" : "dry-run"
  log(`backfill-next-heartbeat-at: mode=${mode} now=${now.toISOString()}`)
  log(`  candidates=${states.length} wouldUpdate/updated=${updated} skipped=${skipped}`)
  for (const row of rows) {
    if (row.skippedReason === "no-schedule") continue
    const prior = row.priorNextHeartbeatAt?.toISOString() ?? "null"
    const next = row.nextHeartbeatAt?.toISOString() ?? "null"
    const tag = row.skippedReason ? ` [${row.skippedReason}]` : ""
    log(
      `  ${row.workspaceId} status=${row.workspaceStatus} name=${JSON.stringify(row.workspaceName)} source=${row.scheduleSource} prior=${prior} next=${next}${tag}`,
    )
  }

  return { mode, now, rows, updated, skipped }
}

async function main(): Promise<void> {
  const confirm = process.env.CONFIRM_BACKFILL === "yes"
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error("DATABASE_URL is required")
  }
  const adapter = new PrismaPg({ connectionString })
  const prisma = new PrismaClient({ adapter })
  try {
    await planAndMaybeApply(prisma as unknown as BackfillDb, { confirm })
  } finally {
    await prisma.$disconnect()
  }
}

const isDirect =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href

if (isDirect) {
  main().catch((err) => {
    console.error(err)
    process.exit(1)
  })
}
