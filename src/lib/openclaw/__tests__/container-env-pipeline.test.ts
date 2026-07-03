// container-env-pipeline.test.ts — PR-8a/B/C end-to-end integration of the three
// helpers the reconciliation cron will chain to detect credential drift:
//
//   getServiceVariables(serviceId)            // ACTUAL env off the live service
//     → (credit mode? top-level var : parseClawsEnvPayload(CLAWS_ENV_GZ_B64/CLAWS_ENV_B64))
//     → fingerprintKey(actualKey)             // ACTUAL fingerprint
//   vs deriveContainerEnv(workspace, user).keyFingerprint   // EXPECTED fingerprint
//
// These tests use the REAL getServiceVariables (fetch is mocked) so the whole
// chain — Railway read + null coercion + decode + fingerprint — is exercised,
// not a stub. deriveContainerEnv is real; only fetch + encryption + logger are
// mocked. See the railway-client.test.ts header for the module-load env gotcha
// (RAILWAY_* captured at import → stub before the dynamic import).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { parseClawsEnvPayload, type RawContainerEnv } from "@/lib/openclaw/container-env-actual"
import { fingerprintKey, deriveContainerEnv } from "@/lib/openclaw/derive-container-env"

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), deployEvent: vi.fn() },
}))
vi.mock("@/lib/encryption", () => ({
  encrypt: (v: string) => `enc:${v}`,
  decrypt: (v: string) => v.replace(/^enc:/, ""),
}))

const b64 = (envText: string) => Buffer.from(envText, "utf8").toString("base64")

// Mirror of the reconciliation cron's "actual key" extraction (formalized in
// PR-8a/C): credit mode keeps the master key as a top-level Railway var; BYOK
// bakes the user key into CLAWS_ENV_GZ_B64 / legacy CLAWS_ENV_B64 (.env).
// Returns null when no key.
function actualKeyFromEnv(env: RawContainerEnv): string | null {
  if (env.CLAWS_CREDIT_MODE === "true") return env.ANTHROPIC_API_KEY ?? null
  const baked = parseClawsEnvPayload(env)
  return baked.ANTHROPIC_API_KEY ?? null
}
function actualFingerprint(env: RawContainerEnv): string | null {
  const key = actualKeyFromEnv(env)
  return key ? fingerprintKey(key) : null
}

// Make the REAL getServiceVariables resolve a crafted env by mocking fetch.
function mockRailwayVariables(variables: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ data: { variables } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  )
}
async function loadGetServiceVariables() {
  return (await import("@/lib/openclaw/railway-client")).getServiceVariables
}

let prevMaster: string | undefined
beforeEach(() => {
  vi.resetModules()
  vi.stubEnv("RAILWAY_API_TOKEN", "test-token")
  vi.stubEnv("RAILWAY_PROJECT_ID", "proj-1")
  vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "env-1")
  prevMaster = process.env.CLAWS_MASTER_ANTHROPIC_KEY
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  if (prevMaster === undefined) delete process.env.CLAWS_MASTER_ANTHROPIC_KEY
  else process.env.CLAWS_MASTER_ANTHROPIC_KEY = prevMaster
})

describe("container-env reconciliation pipeline (PR-8a/B/C)", () => {
  it("A — credit-mode happy path: actual fingerprint matches deriveContainerEnv (master key)", async () => {
    process.env.CLAWS_MASTER_ANTHROPIC_KEY = "sk-ant-master-XYZ-123"
    mockRailwayVariables({
      CLAWS_CREDIT_MODE: "true",
      ANTHROPIC_API_KEY: "sk-ant-master-XYZ-123",
      ANTHROPIC_BASE_URL: "http://localhost:3789",
      CLAWS_ENV_B64: b64("OPENCLAW_GATEWAY_TOKEN=tok\n"),
    })
    const getServiceVariables = await loadGetServiceVariables()
    const env = await getServiceVariables("svc")

    const actual = actualFingerprint(env)
    const expected = deriveContainerEnv(
      { apiKeySourceOverride: "PLATFORM_CREDIT" },
      { apiKeySource: "PLATFORM_CREDIT", apiKeys: [] },
    ).keyFingerprint

    expect(actual).toBe(expected)
    expect(actual).not.toBeNull()
    // BC-2 lock: the comparison surface is a 16-char hash, NOT the raw key.
    expect(actual).toHaveLength(16)
    expect(actual).not.toBe("sk-ant-master-XYZ-123")
  })

  it("B — BYOK happy path: parse CLAWS_ENV_B64 → fingerprint matches deriveContainerEnv (user key)", async () => {
    mockRailwayVariables({
      CLAWS_CREDIT_MODE: "false",
      CLAWS_ENV_B64: b64("OPENCLAW_GATEWAY_TOKEN=tok\nANTHROPIC_API_KEY=sk-ant-byok-USER\n"),
    })
    const getServiceVariables = await loadGetServiceVariables()
    const env = await getServiceVariables("svc")

    const actual = actualFingerprint(env)
    const expected = deriveContainerEnv(
      { apiKeySourceOverride: null },
      { apiKeySource: "USER_OWN_KEY", apiKeys: [{ provider: "ANTHROPIC", encryptedKey: "enc:sk-ant-byok-USER" }] },
    ).keyFingerprint

    expect(actual).toBe(expected)
    expect(actual).toHaveLength(16)
  })

  it("C — NONE: no key in Railway vars nor CLAWS_ENV_B64 → both fingerprints null", async () => {
    mockRailwayVariables({
      CLAWS_CREDIT_MODE: "false",
      CLAWS_ENV_B64: b64("OPENCLAW_GATEWAY_TOKEN=tok\n"),
    })
    const getServiceVariables = await loadGetServiceVariables()
    const env = await getServiceVariables("svc")

    const actual = actualFingerprint(env)
    const expected = deriveContainerEnv(
      { apiKeySourceOverride: null },
      { apiKeySource: "NONE", apiKeys: [] },
    ).keyFingerprint

    expect(actual).toBeNull()
    expect(expected).toBeNull()
  })

  it("D — drift: container master key differs from current DB master → fingerprints DIFFER", async () => {
    process.env.CLAWS_MASTER_ANTHROPIC_KEY = "sk-ant-master-CURRENT"
    mockRailwayVariables({
      CLAWS_CREDIT_MODE: "true",
      ANTHROPIC_API_KEY: "sk-ant-master-STALE-OLD", // container running a rotated-away key
      ANTHROPIC_BASE_URL: "http://localhost:3789",
    })
    const getServiceVariables = await loadGetServiceVariables()
    const env = await getServiceVariables("svc")

    const actual = actualFingerprint(env)
    const expected = deriveContainerEnv(
      { apiKeySourceOverride: "PLATFORM_CREDIT" },
      { apiKeySource: "PLATFORM_CREDIT", apiKeys: [] },
    ).keyFingerprint // fingerprint of the CURRENT master

    expect(actual).not.toBeNull()
    expect(expected).not.toBeNull()
    expect(actual).not.toBe(expected) // ← the drift signal
  })

  it("E — stale BYOK drift: container key X vs DB key Y → fingerprints DIFFER", async () => {
    mockRailwayVariables({
      CLAWS_CREDIT_MODE: "false",
      CLAWS_ENV_B64: b64("ANTHROPIC_API_KEY=sk-ant-byok-X-on-container\n"),
    })
    const getServiceVariables = await loadGetServiceVariables()
    const env = await getServiceVariables("svc")

    const actual = actualFingerprint(env)
    const expected = deriveContainerEnv(
      { apiKeySourceOverride: null },
      { apiKeySource: "USER_OWN_KEY", apiKeys: [{ provider: "ANTHROPIC", encryptedKey: "enc:sk-ant-byok-Y-in-database" }] },
    ).keyFingerprint

    expect(actual).not.toBeNull()
    expect(expected).not.toBeNull()
    expect(actual).not.toBe(expected) // ← the stale-BYOK drift signal
  })

  it("F — Railway returns null variables → getServiceVariables coerces to {} → pipeline yields null (no throw)", async () => {
    mockRailwayVariables(null)
    const getServiceVariables = await loadGetServiceVariables()
    const env = await getServiceVariables("svc")

    // BC-3 lock: the ?? {} coercion in getServiceVariables keeps the pipeline
    // total. Without it, env is null and actualFingerprint(null) throws.
    expect(env).toEqual({})
    expect(actualFingerprint(env)).toBeNull()
  })
})
