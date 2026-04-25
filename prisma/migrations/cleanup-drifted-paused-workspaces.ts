// Cleans up workspaces stuck in pre-PR-#52 PAUSED + containerId-set state.
// Calls destroyContainer for each, which:
//   - Deletes the Railway service if it still exists (idempotent — handles
//     "already gone" gracefully via try/catch + log.warn inside
//     destroyContainer)
//   - Sets status to STOPPED, nulls all container fields
//
// destroyContainer is idempotent. Safe to re-run. If a target's Railway
// service no longer exists, a log.warn fires but the DB state still
// converges to the correct STOPPED + null-fields shape.
//
// Add workspace IDs to TARGETS as drift is identified. This is intentionally
// a manual list (not a SQL filter) so each row gets explicit human review
// — auto-destroying based on a filter risks orphaning live Railway services
// for legitimately paused workspaces if true pauseContainer ever lands.
//
// Usage:
//   npx dotenv -e .env.staging    -- npx tsx prisma/migrations/cleanup-drifted-paused-workspaces.ts
//   npx dotenv -e .env.production -- npx tsx prisma/migrations/cleanup-drifted-paused-workspaces.ts

import { prisma } from "@/lib/db"
import { destroyContainer } from "@/lib/openclaw/deployer"

const TARGETS = [
  // Twitter/X Growth Machine — staging, identified 2026-04-25 during PR #52
  // follow-up audit. PAUSED with containerId 00000000-0000-4000-8000-000000000001
  // and containerHost claw-cmo0cr0z5000004l24n0z8j1w-production.up.railway.app;
  // lastHealthCheck 2026-04-16 (9 days stale).
  "cmo0cr0z5000004l24n0z8j1w",
]

async function main() {
  console.log(`cleanup-drifted-paused-workspaces: starting (${TARGETS.length} targets)`)
  let processed = 0
  let skipped = 0
  let errored = 0

  for (const id of TARGETS) {
    try {
      const before = await prisma.workspace.findUnique({
        where: { id },
        select: { name: true, status: true, containerId: true },
      })
      if (!before) {
        console.log(`  skip  ${id} — not found in this environment`)
        skipped++
        continue
      }
      console.log(
        `  processing  ${id}  ${before.name}  status=${before.status}  containerId=${before.containerId ?? "null"}`,
      )
      await destroyContainer(id)
      const after = await prisma.workspace.findUnique({
        where: { id },
        select: { status: true, containerId: true },
      })
      console.log(`      -> status=${after?.status}  containerId=${after?.containerId ?? "null"}`)
      processed++
    } catch (err) {
      console.error(`  error  ${id}:`, err instanceof Error ? err.message : String(err))
      errored++
    }
  }

  console.log(
    `cleanup-drifted-paused-workspaces: done (processed=${processed} skipped=${skipped} errored=${errored})`,
  )
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
