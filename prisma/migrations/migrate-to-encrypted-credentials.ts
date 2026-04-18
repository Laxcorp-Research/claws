/**
 * Data migration: encryptedApiKey -> encryptedCredentials
 *
 * Usage:
 *   # Dry run against staging (no writes, just report)
 *   npx dotenv -e .env.staging -- npx tsx prisma/migrations/migrate-to-encrypted-credentials.ts --dry-run
 *
 *   # Real run against staging
 *   npx dotenv -e .env.staging -- npx tsx prisma/migrations/migrate-to-encrypted-credentials.ts
 *
 *   # Same for production (assumes schema is already pushed — see PR #2
 *   # deploy runbook)
 *   npx dotenv -e .env.production -- npx tsx prisma/migrations/migrate-to-encrypted-credentials.ts
 *
 * Flags:
 *   --dry-run        Report decisions, write nothing. Exits 1 if any
 *                    orphan slugs are found (same as real-run behavior).
 *   --allow-orphans  Proceed despite orphans. Orphans are reported but
 *                    left untouched in the DB (their encryptedApiKey
 *                    stays as-is, encryptedCredentials stays NULL).
 *                    Use only when you've confirmed with a human what
 *                    to do about the orphan rows.
 *
 * Idempotent: rows that already have encryptedCredentials set are skipped.
 * A second run after a successful first run reports all actions as
 * `skip-already-migrated` and exits 0.
 */

import { prisma } from "@/lib/db"
import { encrypt, decrypt } from "@/lib/encryption"
import {
  buildPlan,
  summarize,
  type MigrationAction,
  type MigrationToolConnection,
} from "@/lib/migrations/encrypted-credentials"

const DRY_RUN = process.argv.includes("--dry-run")
const ALLOW_ORPHANS = process.argv.includes("--allow-orphans")

async function main() {
  console.log(`migrate-to-encrypted-credentials: starting${DRY_RUN ? " (DRY RUN — no writes)" : ""}`)

  const rows = await prisma.toolConnection.findMany({
    select: {
      id: true,
      toolSlug: true,
      connectionType: true,
      status: true,
      encryptedApiKey: true,
      encryptedCredentials: true,
    },
  })

  const migrationRows: MigrationToolConnection[] = rows.map((r) => ({
    id: r.id,
    toolSlug: r.toolSlug,
    connectionType: r.connectionType,
    status: r.status,
    encryptedApiKey: r.encryptedApiKey,
    encryptedCredentials: r.encryptedCredentials,
  }))

  const plan = buildPlan(migrationRows, { encrypt, decrypt })
  const summary = summarize(plan)

  console.log(`Total rows scanned: ${rows.length}`)
  console.log(`  Migrated (single-cred):          ${summary.migratedSingle}`)
  console.log(`  Migrated (partial -> NEEDS_CRED): ${summary.migratedPartialNeedsCredentials}`)
  console.log(`  Skipped (OAUTH_COMPOSIO):         ${summary.skippedOAuth}`)
  console.log(`  Skipped (CHANNEL_NATIVE):         ${summary.skippedChannelNative}`)
  console.log(`  Skipped (null encryptedApiKey):   ${summary.skippedNullKey}`)
  console.log(`  Skipped (already migrated):       ${summary.skippedAlreadyMigrated}`)
  console.log(`  Orphan slugs:                     ${summary.orphans}`)

  if (plan.orphans.length > 0) {
    console.log("")
    console.log(`Orphan rows (toolSlug not in catalog or missing primary field):`)
    for (const orphan of plan.orphans) {
      console.log(`  rowId=${orphan.rowId} toolSlug='${orphan.toolSlug}' reason=${orphan.reason}`)
    }

    if (!ALLOW_ORPHANS) {
      console.error(
        "\nAborting before any writes. Pass --allow-orphans to proceed (orphan rows will be left untouched).",
      )
      process.exit(1)
    }
    console.log("\n--allow-orphans set: proceeding; orphan rows will remain untouched.")
  }

  if (DRY_RUN) {
    console.log("\nDry run complete. No writes performed.")
    return
  }

  let errors = 0
  for (const action of plan.actions) {
    try {
      await applyAction(action)
    } catch (err) {
      errors++
      console.error(
        `Failed to apply action for rowId=${action.rowId} toolSlug='${action.toolSlug}':`,
        err instanceof Error ? err.message : String(err),
      )
    }
  }

  console.log(`\nWrites complete. Errors: ${errors}`)
  if (errors > 0) process.exit(1)
}

async function applyAction(action: MigrationAction) {
  if (action.kind === "migrate-single") {
    await prisma.toolConnection.update({
      where: { id: action.rowId },
      data: { encryptedCredentials: action.encryptedCredentials },
    })
  } else {
    // migrate-partial: write credentials AND flip status to NEEDS_CREDENTIALS
    // so the UI surfaces a Complete button for the missing fields.
    await prisma.toolConnection.update({
      where: { id: action.rowId },
      data: {
        encryptedCredentials: action.encryptedCredentials,
        status: action.nextStatus,
        lastError: `Migration carried only ${action.primaryEnvVar}; missing required fields: ${action.missingFields.join(", ")}`,
      },
    })
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
