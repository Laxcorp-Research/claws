import { describe, it, expect } from "vitest"
import {
  decideForRow,
  buildPlan,
  summarize,
  type EncryptionAdapter,
  type MigrationToolConnection,
} from "@/lib/migrations/encrypted-credentials"

// Identity-pair adapter: the tests operate on plaintext strings so the
// "encrypted" output is deterministic and inspectable.
const identityAdapter: EncryptionAdapter = {
  encrypt: (val) => `ENC(${val})`,
  decrypt: (val) => val.replace(/^ENC\((.*)\)$/, "$1"),
}

// Convenience builder — spread over a minimal row.
function row(overrides: Partial<MigrationToolConnection> = {}): MigrationToolConnection {
  return {
    id: "row-1",
    toolSlug: "tavily",
    connectionType: "API_KEY",
    status: "CONNECTED",
    encryptedApiKey: "tavily-legacy-key",
    encryptedCredentials: null,
    ...overrides,
  }
}

describe("decideForRow", () => {
  it("(a) migrates a single-cred API_KEY row happy-path", () => {
    const decision = decideForRow(row(), identityAdapter)
    expect(decision.kind).toBe("migrate-single")
    if (decision.kind !== "migrate-single") throw new Error("type narrow")
    // Identity encrypt applied to JSON.stringify({ TAVILY_API_KEY: 'tavily-legacy-key' })
    expect(decision.encryptedCredentials).toBe(
      'ENC({"TAVILY_API_KEY":"tavily-legacy-key"})',
    )
    expect(decision.toolSlug).toBe("tavily")
  })

  it("(b) skips OAUTH_COMPOSIO rows (Composio handles auth)", () => {
    const decision = decideForRow(
      row({ connectionType: "OAUTH_COMPOSIO", encryptedApiKey: null, toolSlug: "gmail" }),
      identityAdapter,
    )
    expect(decision.kind).toBe("skip-non-api-key")
    if (decision.kind !== "skip-non-api-key") throw new Error("type narrow")
    expect(decision.connectionType).toBe("OAUTH_COMPOSIO")
  })

  it("(c) skips API_KEY rows with null encryptedApiKey (corrupt/pre-save state)", () => {
    const decision = decideForRow(row({ encryptedApiKey: null }), identityAdapter)
    expect(decision.kind).toBe("skip-null-key")
  })

  it("(d) flags multi-cred tool legacy single-field as NEEDS_CREDENTIALS", () => {
    const decision = decideForRow(
      row({
        toolSlug: "binance",
        encryptedApiKey: "legacy-binance-key",
      }),
      identityAdapter,
    )
    expect(decision.kind).toBe("migrate-partial")
    if (decision.kind !== "migrate-partial") throw new Error("type narrow")
    expect(decision.nextStatus).toBe("NEEDS_CREDENTIALS")
    expect(decision.primaryEnvVar).toBe("BINANCE_API_KEY")
    expect(decision.missingFields).toEqual(["BINANCE_API_SECRET"])
    expect(decision.encryptedCredentials).toBe(
      'ENC({"BINANCE_API_KEY":"legacy-binance-key"})',
    )
  })

  it("(d') coinbase legacy single field flags 2 missing required fields", () => {
    const decision = decideForRow(
      row({ toolSlug: "coinbase", encryptedApiKey: "legacy-coinbase" }),
      identityAdapter,
    )
    expect(decision.kind).toBe("migrate-partial")
    if (decision.kind !== "migrate-partial") throw new Error("type narrow")
    expect(decision.missingFields.sort()).toEqual(
      ["COINBASE_API_SECRET", "COINBASE_API_PASSPHRASE"].sort(),
    )
  })

  it("(e) orphans API_KEY rows whose toolSlug is not in the catalog", () => {
    const decision = decideForRow(
      row({ toolSlug: "totally-unknown-tool" }),
      identityAdapter,
    )
    expect(decision.kind).toBe("orphan-slug")
    if (decision.kind !== "orphan-slug") throw new Error("type narrow")
    expect(decision.reason).toBe("slug-not-in-catalog")
  })

  it("(f) skips rows that already have encryptedCredentials (idempotency)", () => {
    const decision = decideForRow(
      row({ encryptedCredentials: "already-migrated" }),
      identityAdapter,
    )
    expect(decision.kind).toBe("skip-already-migrated")
  })

  it("CHANNEL_NATIVE rows count as non-API_KEY skip", () => {
    const decision = decideForRow(
      row({ connectionType: "CHANNEL_NATIVE", encryptedApiKey: "irrelevant" }),
      identityAdapter,
    )
    expect(decision.kind).toBe("skip-non-api-key")
    if (decision.kind !== "skip-non-api-key") throw new Error("type narrow")
    expect(decision.connectionType).toBe("CHANNEL_NATIVE")
  })

  it("decrypt throws -> orphan (unreadable credential, no silent drop)", () => {
    const throwingAdapter: EncryptionAdapter = {
      encrypt: (v) => v,
      decrypt: () => {
        throw new Error("tampered ciphertext")
      },
    }
    const decision = decideForRow(row(), throwingAdapter)
    expect(decision.kind).toBe("orphan-slug")
    if (decision.kind !== "orphan-slug") throw new Error("type narrow")
    expect(decision.reason).toBe("decrypt-failed")
  })
})

describe("buildPlan + summarize", () => {
  it("fixture: one of each decision path", () => {
    const rows: MigrationToolConnection[] = [
      row({ id: "r-single", toolSlug: "tavily" }), // migrate-single
      row({ id: "r-partial", toolSlug: "binance" }), // migrate-partial
      row({ id: "r-oauth", toolSlug: "gmail", connectionType: "OAUTH_COMPOSIO", encryptedApiKey: null }), // skip-oauth
      row({ id: "r-channel", toolSlug: "slack", connectionType: "CHANNEL_NATIVE", encryptedApiKey: null }), // skip-channel
      row({ id: "r-null", toolSlug: "sendgrid", encryptedApiKey: null }), // skip-null-key
      row({ id: "r-migrated", toolSlug: "stripe_api", encryptedCredentials: "already" }), // skip-already
      row({ id: "r-orphan", toolSlug: "totally-unknown" }), // orphan
    ]

    const plan = buildPlan(rows, identityAdapter)
    expect(plan.actions).toHaveLength(2)
    expect(plan.skips).toHaveLength(4)
    expect(plan.orphans).toHaveLength(1)

    const summary = summarize(plan)
    expect(summary).toEqual({
      migratedSingle: 1,
      migratedPartialNeedsCredentials: 1,
      skippedOAuth: 1,
      skippedChannelNative: 1,
      skippedNullKey: 1,
      skippedAlreadyMigrated: 1,
      orphans: 1,
      errors: 0,
    })
  })

  it("idempotency: running the plan twice (conceptually) produces zero actions on run 2", () => {
    // Simulate a first-run that successfully migrated everything:
    // rows coming into run 2 all have encryptedCredentials set.
    const afterRunOne: MigrationToolConnection[] = [
      row({ id: "r1", toolSlug: "tavily", encryptedCredentials: "encrypted" }),
      row({ id: "r2", toolSlug: "binance", encryptedCredentials: "encrypted" }),
    ]

    const plan = buildPlan(afterRunOne, identityAdapter)
    expect(plan.actions).toHaveLength(0)
    expect(plan.orphans).toHaveLength(0)
    expect(plan.skips).toHaveLength(2)
    expect(plan.skips.every((s) => s.kind === "skip-already-migrated")).toBe(true)
  })

  it("orphan in the row set does not contaminate the actions list", () => {
    const rows: MigrationToolConnection[] = [
      row({ id: "r-good", toolSlug: "tavily" }),
      row({ id: "r-orphan", toolSlug: "ghost-tool" }),
      row({ id: "r-also-good", toolSlug: "sendgrid", encryptedApiKey: "sg-legacy" }),
    ]
    const plan = buildPlan(rows, identityAdapter)
    expect(plan.actions.map((a) => a.rowId).sort()).toEqual(["r-also-good", "r-good"])
    expect(plan.orphans.map((o) => o.rowId)).toEqual(["r-orphan"])
    // Caller (the runner) aborts writes when orphans > 0 unless --allow-orphans.
    // The pure function here doesn't abort; it just classifies.
  })
})
