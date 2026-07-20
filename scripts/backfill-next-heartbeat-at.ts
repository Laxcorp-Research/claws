/**
 * scripts/backfill-next-heartbeat-at.ts
 *
 * Lifecycle P2.1 — one-time arm of ContainerState.nextHeartbeatAt for ALL
 * claws that have a cron and/or interval schedule, regardless of workspace
 * status (HIBERNATED fixture included).
 *
 * When DB schedule columns are null, recovers cron exprs from the gzip
 * runtime snapshot (prefer cron/jobs.json; else HEARTBEAT.md `cron: "..."` lines)
 * and persists heartbeatCronExpressions on apply.
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
import { gunzipSync } from "node:zlib"
import { pathToFileURL } from "node:url"
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { computeNextHeartbeatAt } from "../src/lib/hibernation/next-heartbeat"

export interface BackfillRow {
  workspaceId: string
  workspaceStatus: string
  workspaceName: string
  priorNextHeartbeatAt: Date | null
  nextHeartbeatAt: Date | null
  scheduleSource: "db" | "snapshot-jobs" | "snapshot-heartbeat-md" | "none"
  hydratedCronExpressions?: string
  skippedReason?: string
}

export interface BackfillResult {
  mode: "dry-run" | "applied"
  now: Date
  rows: BackfillRow[]
  updated: number
  skipped: number
}

export type BackfillStateRow = {
  workspaceId: string
  nextHeartbeatAt: Date | null
  heartbeatCronExpressions: string | null
  heartbeatInterval: number | null
  runtimeStateSnapshot: Uint8Array | null
  workspace: { status: string; name: string }
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
        heartbeatCronExpressions?: string
      }
    }) => Promise<unknown>
  }
}

export function extractCronExprsFromHeartbeatMd(text: string): string[] {
  return [...text.matchAll(/cron:\s*"([^"]+)"/g)]
    .map((m) => m[1])
    .filter((e): e is string => typeof e === "string" && e.length > 0)
}

export function cronJobsJsonFromExprs(exprs: string[]): string | null {
  const unique = [...new Set(exprs)]
  if (unique.length === 0) return null
  return JSON.stringify(
    unique.map((expr) => ({
      schedule: { kind: "cron", expr, tz: "UTC" },
    })),
  )
}

/**
 * Recover OpenClaw-shaped cron jobs JSON from a gzip runtime snapshot.
 * Prefer cron/jobs.json; else union cron lines from all HEARTBEAT.md files.
 */
export function recoverCronJobsJsonFromSnapshot(
  gzipBytes: Uint8Array | Buffer,
): { json: string; source: "snapshot-jobs" | "snapshot-heartbeat-md" } | null {
  try {
    const parsed = JSON.parse(gunzipSync(Buffer.from(gzipBytes)).toString("utf8")) as {
      files?: Record<string, string>
    }
    const files = parsed.files ?? {}

    const jobsKey = Object.keys(files).find(
      (p) => p === "cron/jobs.json" || p.endsWith("/cron/jobs.json"),
    )
    if (jobsKey) {
      const raw = Buffer.from(files[jobsKey]!, "base64").toString("utf8")
      if (raw.trim().length > 0 && raw.trim() !== "[]") {
        return { json: raw, source: "snapshot-jobs" }
      }
    }

    const exprs: string[] = []
    for (const path of Object.keys(files)) {
      if (!path.endsWith("HEARTBEAT.md")) continue
      const raw = Buffer.from(files[path]!, "base64").toString("utf8")
      exprs.push(...extractCronExprsFromHeartbeatMd(raw))
    }
    const json = cronJobsJsonFromExprs(exprs)
    if (!json) return null
    return { json, source: "snapshot-heartbeat-md" }
  } catch {
    return null
  }
}

function hasDbCron(cron: string | null | undefined): boolean {
  return typeof cron === "string" && cron.length > 0 && cron !== "[]"
}

function hasDbInterval(interval: number | null | undefined): boolean {
  return typeof interval === "number" && Number.isFinite(interval) && interval > 0
}

export async function planAndMaybeApply(
  db: BackfillDb,
  opts: { confirm: boolean; now?: Date; log?: (msg: string) => void },
): Promise<BackfillResult> {
  const log = opts.log ?? console.log
  const now = opts.now ?? new Date()

  // All ContainerState rows — schedule may live only in the snapshot.
  const states = await db.containerState.findMany({
    select: {
      workspaceId: true,
      nextHeartbeatAt: true,
      heartbeatCronExpressions: true,
      heartbeatInterval: true,
      runtimeStateSnapshot: true,
      workspace: { select: { status: true, name: true } },
    },
  })

  const rows: BackfillRow[] = []
  let updated = 0
  let skipped = 0

  for (const state of states) {
    let cronExprs = state.heartbeatCronExpressions
    let scheduleSource: BackfillRow["scheduleSource"] = hasDbCron(cronExprs)
      ? "db"
      : hasDbInterval(state.heartbeatInterval)
        ? "db"
        : "none"
    let hydratedCron: string | undefined

    if (!hasDbCron(cronExprs) && !hasDbInterval(state.heartbeatInterval)) {
      if (state.runtimeStateSnapshot) {
        const recovered = recoverCronJobsJsonFromSnapshot(state.runtimeStateSnapshot)
        if (recovered) {
          cronExprs = recovered.json
          scheduleSource = recovered.source
          hydratedCron = recovered.json
        }
      }
    }

    if (!hasDbCron(cronExprs) && !hasDbInterval(state.heartbeatInterval) && !hydratedCron) {
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
      heartbeatIntervalMs: state.heartbeatInterval,
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
        skippedReason: "compute-null",
      })
      continue
    }

    const hintUnchanged =
      state.nextHeartbeatAt !== null &&
      state.nextHeartbeatAt.getTime() === nextHeartbeatAt.getTime()
    const needsCronPersist = Boolean(hydratedCron) && !hasDbCron(state.heartbeatCronExpressions)
    const unchanged = hintUnchanged && !needsCronPersist

    rows.push({
      workspaceId: state.workspaceId,
      workspaceStatus: state.workspace.status,
      workspaceName: state.workspace.name,
      priorNextHeartbeatAt: state.nextHeartbeatAt,
      nextHeartbeatAt,
      scheduleSource,
      hydratedCronExpressions: hydratedCron,
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
