/**
 * scripts/archive/backfill-superseded-deployments.ts
 *
 * Idempotent: for each workspace, keep the newest COMPLETED Deployment row;
 * mark older COMPLETED rows SUPERSEDED. Closes zombie fanout from hibernate/wake
 * cycles that never retired prior success rows.
 *
 * USAGE (staging — run after migrate):
 *   Dry-run (DEFAULT):
 *     npx dotenv -e .env.staging -- npx tsx scripts/archive/backfill-superseded-deployments.ts
 *   Apply:
 *     CONFIRM_BACKFILL=yes npx dotenv -e .env.staging -- npx tsx scripts/archive/backfill-superseded-deployments.ts
 *
 * PROD: do NOT run from this agent. Founder card SQL is printed with --print-prod-card.
 */
import { pathToFileURL } from "node:url"
import { PrismaClient } from "../../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

export const BACKFILL_SQL = `
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY "workspaceId"
           ORDER BY "startedAt" DESC, id DESC
         ) AS rn
  FROM "Deployment"
  WHERE status = 'COMPLETED'
)
UPDATE "Deployment" AS d
SET status = 'SUPERSEDED'
FROM ranked AS r
WHERE d.id = r.id
  AND r.rn > 1
  AND d.status = 'COMPLETED'
RETURNING d.id, d."workspaceId"
`.trim()

export const PROD_FOUNDER_CARD = `
## Founder card — prod Deployment SUPERSEDED backfill (DO NOT auto-run)

**Why:** Prod canary wake cycles accumulate COMPLETED Deployment rows (same fanout bug as staging 81→82). Force-Update would email/count zombies.

**Preflight (read-only):**
\`\`\`sql
SELECT status, count(*) FROM "Deployment" GROUP BY 1;
SELECT "workspaceId", count(*) FROM "Deployment" WHERE status='COMPLETED' GROUP BY 1 HAVING count(*)>1 ORDER BY 2 DESC;
\`\`\`

**Apply (prod DB, after schema has SUPERSEDED):**
\`\`\`sql
${BACKFILL_SQL};
\`\`\`

**Verify:**
\`\`\`sql
SELECT status, count(*) FROM "Deployment" GROUP BY 1;
-- Expect at most 1 COMPLETED per workspaceId
SELECT "workspaceId", count(*) FROM "Deployment" WHERE status='COMPLETED' GROUP BY 1 HAVING count(*)>1;
\`\`\`

**Rollback:** restore from snapshot only — SUPERSEDED→COMPLETED is unsafe without knowing which row was current.
`.trim()

export async function runBackfill(opts: {
  confirm: boolean
  executeSql: (sql: string) => Promise<{ rowCount: number | null }>
}): Promise<{ mode: "dry-run" | "applied"; wouldAffectHint: string; rowCount: number | null }> {
  if (!opts.confirm) {
    return {
      mode: "dry-run",
      wouldAffectHint: "Set CONFIRM_BACKFILL=yes to apply BACKFILL_SQL",
      rowCount: null,
    }
  }
  const result = await opts.executeSql(BACKFILL_SQL)
  return { mode: "applied", wouldAffectHint: "applied", rowCount: result.rowCount }
}

async function main() {
  if (process.argv.includes("--print-prod-card")) {
    console.log(PROD_FOUNDER_CARD)
    return
  }

  const confirm = process.env.CONFIRM_BACKFILL === "yes"
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error("DATABASE_URL required")
    process.exit(1)
  }

  const adapter = new PrismaPg({ connectionString })
  const prisma = new PrismaClient({ adapter })

  try {
    if (!confirm) {
      const multi = await prisma.$queryRawUnsafe<Array<{ workspaceId: string; n: bigint }>>(
        `SELECT "workspaceId", count(*)::bigint AS n
         FROM "Deployment" WHERE status = 'COMPLETED'
         GROUP BY "workspaceId" HAVING count(*) > 1
         ORDER BY n DESC LIMIT 20`,
      )
      console.log("DRY-RUN — workspaces with multiple COMPLETED rows:")
      console.log(JSON.stringify(multi, (_, v) => (typeof v === "bigint" ? Number(v) : v), 2))
      console.log("\nSQL that would run:\n", BACKFILL_SQL)
      console.log("\nRe-run with CONFIRM_BACKFILL=yes to apply.")
      return
    }

    const rows = await prisma.$queryRawUnsafe<Array<{ id: string; workspaceId: string }>>(
      BACKFILL_SQL,
    )
    console.log(`Applied SUPERSEDED backfill: ${rows.length} rows`)
    console.log(JSON.stringify(rows.slice(0, 30), null, 2))
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
