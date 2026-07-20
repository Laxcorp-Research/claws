/**
 * scripts/backfill-next-heartbeat-at.ts
 *
 * Lifecycle P2.1 — one-time arm of ContainerState.nextHeartbeatAt for ALL
 * claws that have a cron and/or interval schedule, regardless of workspace
 * status (HIBERNATED fixture included).
 *
 * USAGE
 *   Dry-run (DEFAULT):
 *     npx dotenv -e .env.staging -- npx tsx scripts/backfill-next-heartbeat-at.ts
 *   Apply:
 *     # bash:
 *     CONFIRM_BACKFILL=yes npx dotenv -e .env.staging -- npx tsx scripts/backfill-next-heartbeat-at.ts
 *     # PowerShell:
 *     $env:CONFIRM_BACKFILL="yes"; npx dotenv -e .env.staging -- npx tsx scripts/backfill-next-heartbeat-at.ts; Remove-Item Env:CONFIRM_BACKFILL
 *
 * SAFETY
 *   - Defaults to DRY-RUN.
 *   - Idempotent: re-running with the same wall clock yields the same hint
 *     (computeNextHeartbeatAt is pure given `now`).
 */
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
  skippedReason?: string
}

export interface BackfillResult {
  mode: "dry-run" | "applied"
  now: Date
  rows: BackfillRow[]
  updated: number
  skipped: number
}

type BackfillDb = Pick<PrismaClient, "containerState">

export async function planAndMaybeApply(
  db: BackfillDb,
  opts: { confirm: boolean; now?: Date; log?: (msg: string) => void },
): Promise<BackfillResult> {
  const log = opts.log ?? console.log
  const now = opts.now ?? new Date()

  const states = await db.containerState.findMany({
    where: {
      OR: [
        { heartbeatCronExpressions: { not: null } },
        { heartbeatInterval: { not: null } },
      ],
    },
    select: {
      workspaceId: true,
      nextHeartbeatAt: true,
      heartbeatCronExpressions: true,
      heartbeatInterval: true,
      workspace: { select: { status: true, name: true } },
    },
  })

  const rows: BackfillRow[] = []
  let updated = 0
  let skipped = 0

  for (const state of states) {
    const hasCron =
      typeof state.heartbeatCronExpressions === "string" &&
      state.heartbeatCronExpressions.length > 0 &&
      state.heartbeatCronExpressions !== "[]"
    const hasInterval =
      typeof state.heartbeatInterval === "number" && state.heartbeatInterval > 0

    if (!hasCron && !hasInterval) {
      skipped++
      rows.push({
        workspaceId: state.workspaceId,
        workspaceStatus: state.workspace.status,
        workspaceName: state.workspace.name,
        priorNextHeartbeatAt: state.nextHeartbeatAt,
        nextHeartbeatAt: null,
        skippedReason: "no-parseable-schedule",
      })
      continue
    }

    const nextHeartbeatAt = computeNextHeartbeatAt({
      now,
      heartbeatCronExpressions: state.heartbeatCronExpressions,
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
        skippedReason: "compute-null",
      })
      continue
    }

    const unchanged =
      state.nextHeartbeatAt !== null &&
      state.nextHeartbeatAt.getTime() === nextHeartbeatAt.getTime()

    rows.push({
      workspaceId: state.workspaceId,
      workspaceStatus: state.workspace.status,
      workspaceName: state.workspace.name,
      priorNextHeartbeatAt: state.nextHeartbeatAt,
      nextHeartbeatAt,
      skippedReason: unchanged ? "already-armed" : undefined,
    })

    if (unchanged) {
      skipped++
      continue
    }

    if (opts.confirm) {
      await db.containerState.update({
        where: { workspaceId: state.workspaceId },
        data: { nextHeartbeatAt },
      })
    }
    updated++
  }

  const mode = opts.confirm ? "applied" : "dry-run"
  log(`backfill-next-heartbeat-at: mode=${mode} now=${now.toISOString()}`)
  log(`  candidates=${states.length} wouldUpdate/updated=${updated} skipped=${skipped}`)
  for (const row of rows) {
    const prior = row.priorNextHeartbeatAt?.toISOString() ?? "null"
    const next = row.nextHeartbeatAt?.toISOString() ?? "null"
    const tag = row.skippedReason ? ` [${row.skippedReason}]` : ""
    log(
      `  ${row.workspaceId} status=${row.workspaceStatus} name=${JSON.stringify(row.workspaceName)} prior=${prior} next=${next}${tag}`,
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
    await planAndMaybeApply(prisma, { confirm })
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
