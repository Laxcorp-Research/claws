/**
 * One-off data migration: reclassify PAUSED workspaces with no container as STOPPED.
 *
 * Context: before the pause/destroy distinction PR, the only "pause" mechanism
 * was destructive (stopContainer → Railway service deleted, containerId nulled),
 * and the resulting workspace was labeled PAUSED. That label was misleading:
 * there is nothing to resume — the container is gone. The PR introduces STOPPED
 * as the honest label for that state, and reserves PAUSED for future reversible
 * pause (when Railway's suspend/resume capability is confirmed).
 *
 * This script reclassifies the pre-PR PAUSED rows. Criterion: PAUSED AND
 * containerId IS NULL. Rows with containerId set are left alone — they
 * represent potential drift states that need separate review.
 *
 * Usage (staging):
 *   npx dotenv -e .env.staging -- npx tsx scripts/archive/reclassify-paused-destroyed.ts
 *
 * Usage (production):
 *   npx dotenv -e .env.production -- npx tsx scripts/archive/reclassify-paused-destroyed.ts
 *
 * Idempotent: second run finds 0 rows to update and exits cleanly.
 */

import { prisma } from "@/lib/db"

async function main() {
  console.log("reclassify-paused-destroyed: starting")

  const targets = await prisma.workspace.findMany({
    where: {
      status: "PAUSED",
      containerId: null,
    },
    select: { id: true, name: true, userId: true },
  })

  console.log(`Found ${targets.length} PAUSED workspaces with null containerId`)

  if (targets.length === 0) {
    console.log("Nothing to reclassify. Exiting.")
    return
  }

  for (const ws of targets.slice(0, 5)) {
    console.log(`  - ${ws.id}  ${ws.name}  (user ${ws.userId})`)
  }
  if (targets.length > 5) {
    console.log(`  ... and ${targets.length - 5} more`)
  }

  const result = await prisma.workspace.updateMany({
    where: {
      status: "PAUSED",
      containerId: null,
    },
    data: {
      status: "STOPPED",
    },
  })

  console.log(`Reclassified ${result.count} rows: PAUSED -> STOPPED`)
  console.log("reclassify-paused-destroyed: done")
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
