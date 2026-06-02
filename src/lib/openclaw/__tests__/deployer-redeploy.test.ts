// deployer-redeploy.test.ts — harness + locking tests for redeployWorkspace.
//
// PR-8a unified credential derivation (buildRailwayEnvVars now derives from
// deriveContainerEnv). redeployWorkspace is the SECOND caller of
// buildRailwayEnvVars and received the same `include: { apiKeys: true }` fix,
// but it had ZERO test coverage. This file closes that gap and locks its
// contract:
//   A — the apiKeys relation is loaded (mutation lock for the include).
//   B — the fast-path guard (isRailwayConfigured && containerId && RUNNING).
//   C — env vars are derived per apiKeySource, identical to deployToCloud.
//   D — updateServiceVariables runs BEFORE redeployService (invariant I6).
//
// Mock conventions mirror deployer-image-resolution / deployer-state-ordering,
// with TWO deliberate differences:
//   1. railway-client also mocks updateServiceVariables + redeployService — the
//      redeploy fast-path helpers the other files don't touch.
//   2. @/lib/credits/api-key-source is intentionally NOT mocked. Test C
//      exercises the REAL apiKeySource -> env derivation, which is the entire
//      point of the behavior test. (The other deployer test files mock it to a
//      constant because they assert image resolution / call ordering, not
//      derivation.)
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

const mockCreateService = vi.fn()
const mockUpdateAndRedeployService = vi.fn()
const mockGetServiceStatus = vi.fn()
const mockIsRailwayConfigured = vi.fn()
const mockDeleteService = vi.fn()
const mockFindServiceByName = vi.fn()
const mockUpdateServiceVariables = vi.fn()
const mockRedeployService = vi.fn()

vi.mock("@/lib/openclaw/railway-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/openclaw/railway-client")>(
    "@/lib/openclaw/railway-client",
  )
  return {
    ...actual,
    createService: (...args: unknown[]) => mockCreateService(...args),
    updateAndRedeployService: (...args: unknown[]) => mockUpdateAndRedeployService(...args),
    getServiceStatus: (...args: unknown[]) => mockGetServiceStatus(...args),
    isRailwayConfigured: () => mockIsRailwayConfigured(),
    deleteService: (...args: unknown[]) => mockDeleteService(...args),
    findServiceByName: (...args: unknown[]) => mockFindServiceByName(...args),
    updateServiceVariables: (...args: unknown[]) => mockUpdateServiceVariables(...args),
    redeployService: (...args: unknown[]) => mockRedeployService(...args),
  }
})

const mockGenerateWorkspace = vi.fn()
vi.mock("@/lib/openclaw/generator", async () => {
  const actual = await vi.importActual<typeof import("@/lib/openclaw/generator")>(
    "@/lib/openclaw/generator",
  )
  return {
    ...actual,
    generateWorkspace: (...args: unknown[]) => mockGenerateWorkspace(...args),
  }
})

vi.mock("@/lib/encryption", () => ({
  encrypt: (v: string) => `enc:${v}`,
  decrypt: (v: string) => v.replace(/^enc:/, ""),
}))

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), deployEvent: vi.fn() },
}))

vi.mock("@/lib/deploy-events", () => ({
  publishDeployEvent: vi.fn().mockResolvedValue(undefined),
  clearDeployEvents: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/composio", () => ({
  getComposioUserId: (id: string) => `claws_${id}`,
}))

import { redeployWorkspace } from "@/lib/openclaw/deployer"

function generatedStub() {
  return {
    "openclaw.json": "{}",
    ".env": "",
    "cron/jobs.json": "[]",
    workspaces: {},
    gatewayToken: "gw-token",
  } as unknown as Awaited<ReturnType<typeof import("@/lib/openclaw/generator").generateWorkspace>>
}

function workspaceStub(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "ws-redeploy",
    userId: "user-redeploy",
    status: "RUNNING",
    containerId: "svc-existing",
    containerName: "claws-ws-redeploy",
    containerHost: "svc-existing.up.railway.app",
    channelConfigEncrypted: null,
    timezone: "UTC",
    apiKeySourceOverride: null,
    gatewayToken: null,
    ...overrides,
  }
}

function userStub(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "user-redeploy",
    trialUsed: false,
    apiKeySource: "USER_OWN_KEY",
    apiKeys: [],
    ...overrides,
  }
}

let prevEnv: Record<string, string | undefined>
// Monotonic Railway deployment id so deployToCloud's existing-service redeploy
// path (Test B's DRAFT+containerId variant) observes a CHANGED deploymentId and
// stops polling. A constant id would loop forever (poll-until-new-deployment).
let statusCallCount = 0

beforeEach(() => {
  statusCallCount = 0
  mockCreateService.mockReset()
  mockUpdateAndRedeployService.mockReset()
  mockGetServiceStatus.mockReset()
  mockIsRailwayConfigured.mockReset()
  mockDeleteService.mockReset()
  mockFindServiceByName.mockReset()
  mockUpdateServiceVariables.mockReset()
  mockRedeployService.mockReset()
  mockGenerateWorkspace.mockReset()

  mockIsRailwayConfigured.mockReturnValue(true)
  mockGenerateWorkspace.mockResolvedValue(generatedStub())
  mockUpdateServiceVariables.mockResolvedValue(undefined)
  mockRedeployService.mockResolvedValue(undefined)
  // Defaults so the deployToCloud fall-through (Test B negative variants)
  // runs to completion instead of throwing.
  mockCreateService.mockResolvedValue({ serviceId: "svc-new", domain: "svc-new.up.railway.app" })
  mockUpdateAndRedeployService.mockResolvedValue({
    serviceId: "svc-existing",
    domain: "svc-existing.up.railway.app",
  })
  mockGetServiceStatus.mockImplementation(async () => ({
    status: "SUCCESS",
    deploymentId: `dep-rw-${++statusCallCount}`,
    healthy: true,
  }))

  // env-guards inside buildRailwayEnvVars require a coherent staging-shaped
  // endpoint triple (host-match). See src/lib/openclaw/env-guards.ts.
  prevEnv = {
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    METERING_ENDPOINT: process.env.METERING_ENDPOINT,
    ACTIVITY_ENDPOINT: process.env.ACTIVITY_ENDPOINT,
    COMPOSIO_API_KEY: process.env.COMPOSIO_API_KEY,
    CLAWS_MASTER_ANTHROPIC_KEY: process.env.CLAWS_MASTER_ANTHROPIC_KEY,
  }
  process.env.NEXT_PUBLIC_APP_URL = "https://staging.app.buildclaws.ai"
  process.env.METERING_ENDPOINT = "https://staging.app.buildclaws.ai/api/internal/metering"
  process.env.ACTIVITY_ENDPOINT = "https://staging.app.buildclaws.ai/api/internal/activity"
  // Composio off — orthogonal to these tests (no platform-key pin to assert).
  delete process.env.COMPOSIO_API_KEY
  // Master key for the PLATFORM_CREDIT derivation variant (Test C1).
  process.env.CLAWS_MASTER_ANTHROPIC_KEY = "sk-ant-master-test"

  // deployToCloud fall-through prisma surface (Test B negative variants).
  ;(prismaMock.openClawVersion.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)
  ;(prismaMock.containerState.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "cs-1" })
  ;(prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({})
  ;(prismaMock.deployment.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "dep-1" })
  ;(prismaMock.deployment.update as ReturnType<typeof vi.fn>).mockResolvedValue({})
  ;(prismaMock.deployment.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ version: 0 })
})

afterEach(() => {
  for (const [k, v] of Object.entries(prevEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

// Test A — the apiKeys relation is loaded on the redeploy path.
describe("redeployWorkspace — loads user.apiKeys (PR-8a include lock)", () => {
  it("calls prisma.user.findUniqueOrThrow with include:{apiKeys:true} so deriveContainerEnv sees BYOK keys", async () => {
    ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(workspaceStub())
    ;(prismaMock.user.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(userStub())

    await redeployWorkspace("ws-redeploy")

    // Direct parallel to deployer-image-resolution's deploy-path include lock.
    // Mutation: drop the include from redeployWorkspace's user query -> fails.
    expect(prismaMock.user.findUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({ include: { apiKeys: true } }),
    )
  })
})

// Test B — the fast-path guard at deployer.ts:426
//   (isRailwayConfigured && workspace.containerId && status === 'RUNNING').
describe("redeployWorkspace — fast-path guard (RUNNING + containerId)", () => {
  it("RUNNING + containerId=null → no redeploy fast-path (falls through to deployToCloud)", async () => {
    ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
      workspaceStub({ containerId: null }),
    )
    ;(prismaMock.user.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(userStub())

    await redeployWorkspace("ws-redeploy")

    expect(mockUpdateServiceVariables).not.toHaveBeenCalled()
    expect(mockRedeployService).not.toHaveBeenCalled()
  })

  it("DRAFT + containerId set → no redeploy fast-path (falls through to deployToCloud)", async () => {
    ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
      workspaceStub({ status: "DRAFT" }),
    )
    ;(prismaMock.user.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(userStub())

    await redeployWorkspace("ws-redeploy")

    expect(mockUpdateServiceVariables).not.toHaveBeenCalled()
    expect(mockRedeployService).not.toHaveBeenCalled()
  })

  it("RUNNING + containerId set → redeploy fast-path fires; no full-deploy createService path", async () => {
    ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(workspaceStub())
    ;(prismaMock.user.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(userStub())

    await redeployWorkspace("ws-redeploy")

    expect(mockUpdateServiceVariables).toHaveBeenCalledTimes(1)
    expect(mockRedeployService).toHaveBeenCalledTimes(1)
    // Fast-path is updateVars + redeploy, NOT a full deployToCloud.
    expect(mockCreateService).not.toHaveBeenCalled()
    expect(mockUpdateAndRedeployService).not.toHaveBeenCalled()
    // Fast-path targets the existing service id.
    expect(mockUpdateServiceVariables.mock.calls[0][0]).toBe("svc-existing")
    expect(mockRedeployService.mock.calls[0][0]).toBe("svc-existing")
  })
})

// Test C — env vars derived per apiKeySource, identical to deployToCloud.
// These run the REAL deriveContainerEnv (api-key-source is not mocked).
describe("redeployWorkspace — env derivation per apiKeySource (parity with deployToCloud)", () => {
  it("PLATFORM_CREDIT user → credit mode + master key + proxy base URL in the Railway env", async () => {
    ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(workspaceStub())
    ;(prismaMock.user.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
      userStub({ apiKeySource: "PLATFORM_CREDIT" }),
    )

    await redeployWorkspace("ws-redeploy")

    const [, env] = mockUpdateServiceVariables.mock.calls[0]
    expect(env.CLAWS_CREDIT_MODE).toBe("true")
    expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-master-test")
    expect(env.ANTHROPIC_BASE_URL).toBe("http://localhost:3789")
    expect(env.CLAWS_USER_ID).toBe("user-redeploy")
  })

  it("USER_OWN_KEY user WITH an Anthropic key → non-credit; BYOK key is NOT a Railway var (security)", async () => {
    ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(workspaceStub())
    ;(prismaMock.user.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
      userStub({
        apiKeySource: "USER_OWN_KEY",
        apiKeys: [{ provider: "ANTHROPIC", encryptedKey: "enc:sk-ant-byok-secret" }],
      }),
    )

    await redeployWorkspace("ws-redeploy")

    const [, env] = mockUpdateServiceVariables.mock.calls[0]
    expect(env.CLAWS_CREDIT_MODE).toBe("false")
    // Security: a BYOK key is baked into CLAWS_ENV_B64 by the generator, NOT
    // surfaced as a Railway variable. updateServiceVariables must never carry
    // the decrypted secret. This is the meaningful "with key" case.
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(env.CLAWS_USER_ID).toBeUndefined()
    expect(JSON.stringify(env)).not.toContain("sk-ant-byok-secret")
  })

  it("USER_OWN_KEY user WITHOUT a key → non-credit, no Anthropic vars", async () => {
    ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(workspaceStub())
    ;(prismaMock.user.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
      userStub({ apiKeySource: "USER_OWN_KEY", apiKeys: [] }),
    )

    await redeployWorkspace("ws-redeploy")

    const [, env] = mockUpdateServiceVariables.mock.calls[0]
    expect(env.CLAWS_CREDIT_MODE).toBe("false")
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined()
  })
})

// Test D — atomicity invariant I6: the full var set is written before the
// single restart, so a container never restarts against a partial env.
describe("redeployWorkspace — write-before-restart ordering (invariant I6)", () => {
  it("calls updateServiceVariables BEFORE redeployService", async () => {
    ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(workspaceStub())
    ;(prismaMock.user.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(userStub())

    await redeployWorkspace("ws-redeploy")

    const varsOrder = mockUpdateServiceVariables.mock.invocationCallOrder[0]
    const redeployOrder = mockRedeployService.mock.invocationCallOrder[0]
    expect(varsOrder).toBeLessThan(redeployOrder)
  })
})
