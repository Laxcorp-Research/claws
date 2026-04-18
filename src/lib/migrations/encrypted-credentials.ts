/**
 * Pure logic for the encryptedApiKey -> encryptedCredentials backfill.
 * Kept separate from the CLI runner (prisma/migrations/
 * migrate-to-encrypted-credentials.ts) so the per-row decision function
 * can be unit-tested without a DB or Prisma mock.
 *
 * The runner is responsible for:
 *   1. Loading rows from prisma.toolConnection.findMany
 *   2. Calling `buildPlan(rows, catalog)` -> pre-flight orphan check
 *   3. If plan.orphans.length > 0 && !allowOrphans -> abort before writes
 *   4. Otherwise iterate actions calling prisma.toolConnection.update
 *   5. Reporting counts
 */

import { ALL_TOOLS, type ToolCredentialField } from "@/data/tool-catalog"

export type MigrationToolConnection = {
  id: string
  toolSlug: string
  connectionType: "API_KEY" | "OAUTH_COMPOSIO" | "CHANNEL_NATIVE" | string
  status: string
  encryptedApiKey: string | null
  encryptedCredentials: string | null
}

/** Dependency injection shape for encryption. Real impl lives in
 * src/lib/encryption; tests pass in identity-like mocks. */
export type EncryptionAdapter = {
  encrypt: (plaintext: string) => string
  decrypt: (ciphertext: string) => string
}

export type MigrationAction =
  | {
      kind: "migrate-single"
      rowId: string
      toolSlug: string
      encryptedCredentials: string
      nextStatus?: undefined
    }
  | {
      kind: "migrate-partial"
      rowId: string
      toolSlug: string
      encryptedCredentials: string
      nextStatus: "NEEDS_CREDENTIALS"
      primaryEnvVar: string
      missingFields: string[]
    }

export type MigrationSkip =
  | { kind: "skip-non-api-key"; rowId: string; toolSlug: string; connectionType: string }
  | { kind: "skip-null-key"; rowId: string; toolSlug: string }
  | { kind: "skip-already-migrated"; rowId: string; toolSlug: string }

export type MigrationOrphan = {
  kind: "orphan-slug"
  rowId: string
  toolSlug: string
  reason: "slug-not-in-catalog" | "no-primary-field" | "decrypt-failed"
}

export type MigrationDecision = MigrationAction | MigrationSkip | MigrationOrphan

export type MigrationPlan = {
  actions: MigrationAction[]
  skips: MigrationSkip[]
  orphans: MigrationOrphan[]
}

/**
 * Decide what to do with a single ToolConnection row.
 *
 * Skip cases do not touch the row. Orphan cases are reported up and the
 * caller (runner) aborts before writing anything if any orphan exists,
 * unless the operator passes a flag to proceed anyway.
 */
export function decideForRow(
  row: MigrationToolConnection,
  enc: EncryptionAdapter,
  toolsById = new Map<string, { slug: string; credentialFields: ToolCredentialField[] }>(
    ALL_TOOLS.map((t) => [t.slug, { slug: t.slug, credentialFields: t.credentialFields }]),
  ),
): MigrationDecision {
  // Already migrated -> skip (idempotent)
  if (row.encryptedCredentials) {
    return { kind: "skip-already-migrated", rowId: row.id, toolSlug: row.toolSlug }
  }

  // Non-API_KEY (OAUTH_COMPOSIO, CHANNEL_NATIVE) -> skip untouched
  if (row.connectionType !== "API_KEY") {
    return {
      kind: "skip-non-api-key",
      rowId: row.id,
      toolSlug: row.toolSlug,
      connectionType: row.connectionType,
    }
  }

  // API_KEY row with null legacy column -> nothing to migrate. Not fatal;
  // the UI can't have created this state in a happy path, so log + skip.
  if (!row.encryptedApiKey) {
    return { kind: "skip-null-key", rowId: row.id, toolSlug: row.toolSlug }
  }

  // Catalog lookup -> if missing, this is an orphan slug that needs human
  // disposition (see GH #27/#28 for the pattern).
  const tool = toolsById.get(row.toolSlug)
  if (!tool) {
    return {
      kind: "orphan-slug",
      rowId: row.id,
      toolSlug: row.toolSlug,
      reason: "slug-not-in-catalog",
    }
  }

  const primary = tool.credentialFields.find((f) => f.primary)
  if (!primary) {
    // Tool is in catalog but has no declared primary field (should never
    // happen for API_KEY tools; flag as orphan-equivalent for disposition).
    return {
      kind: "orphan-slug",
      rowId: row.id,
      toolSlug: row.toolSlug,
      reason: "no-primary-field",
    }
  }

  // Decrypt legacy single key; if that fails, surface as orphan because
  // the runner should not silently drop an unreadable credential.
  let plainKey: string
  try {
    plainKey = enc.decrypt(row.encryptedApiKey)
  } catch {
    return {
      kind: "orphan-slug",
      rowId: row.id,
      toolSlug: row.toolSlug,
      reason: "decrypt-failed",
    }
  }

  const credentialFields = tool.credentialFields
  const newCredentials: Record<string, string> = { [primary.envVar]: plainKey }
  const encryptedCredentials = enc.encrypt(JSON.stringify(newCredentials))

  if (credentialFields.length === 1) {
    return {
      kind: "migrate-single",
      rowId: row.id,
      toolSlug: row.toolSlug,
      encryptedCredentials,
    }
  }

  const missingFields = credentialFields
    .filter((f) => f.required && f.envVar !== primary.envVar)
    .map((f) => f.envVar)
  return {
    kind: "migrate-partial",
    rowId: row.id,
    toolSlug: row.toolSlug,
    encryptedCredentials,
    nextStatus: "NEEDS_CREDENTIALS",
    primaryEnvVar: primary.envVar,
    missingFields,
  }
}

/**
 * Pre-flight: classify every row so the runner can abort if any orphans
 * are present before writing anything.
 */
export function buildPlan(
  rows: MigrationToolConnection[],
  enc: EncryptionAdapter,
): MigrationPlan {
  const actions: MigrationAction[] = []
  const skips: MigrationSkip[] = []
  const orphans: MigrationOrphan[] = []

  const toolsById = new Map<string, { slug: string; credentialFields: ToolCredentialField[] }>(
    ALL_TOOLS.map((t) => [t.slug, { slug: t.slug, credentialFields: t.credentialFields }]),
  )

  for (const row of rows) {
    const decision = decideForRow(row, enc, toolsById)
    if (decision.kind === "orphan-slug") orphans.push(decision)
    else if (
      decision.kind === "skip-non-api-key" ||
      decision.kind === "skip-null-key" ||
      decision.kind === "skip-already-migrated"
    ) {
      skips.push(decision)
    } else {
      actions.push(decision)
    }
  }

  return { actions, skips, orphans }
}

export type MigrationSummary = {
  migratedSingle: number
  migratedPartialNeedsCredentials: number
  skippedOAuth: number
  skippedChannelNative: number
  skippedNullKey: number
  skippedAlreadyMigrated: number
  orphans: number
  errors: number
}

export function emptySummary(): MigrationSummary {
  return {
    migratedSingle: 0,
    migratedPartialNeedsCredentials: 0,
    skippedOAuth: 0,
    skippedChannelNative: 0,
    skippedNullKey: 0,
    skippedAlreadyMigrated: 0,
    orphans: 0,
    errors: 0,
  }
}

/**
 * Aggregate a plan's decisions into counts for the final report.
 */
export function summarize(plan: MigrationPlan): MigrationSummary {
  const s = emptySummary()
  for (const a of plan.actions) {
    if (a.kind === "migrate-single") s.migratedSingle++
    else s.migratedPartialNeedsCredentials++
  }
  for (const skip of plan.skips) {
    if (skip.kind === "skip-already-migrated") s.skippedAlreadyMigrated++
    else if (skip.kind === "skip-null-key") s.skippedNullKey++
    else if (skip.kind === "skip-non-api-key") {
      if (skip.connectionType === "OAUTH_COMPOSIO") s.skippedOAuth++
      else s.skippedChannelNative++
    }
  }
  s.orphans = plan.orphans.length
  return s
}
