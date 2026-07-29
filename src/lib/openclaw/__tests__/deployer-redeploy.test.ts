// deployer-redeploy.test.ts — redeployWorkspace uses the honest deploy path.
//
// Regression locked here: the old private fast path did
// updateServiceVariables → redeployService → COMPLETED without waiting for a
// new Railway deployment. redeployWorkspace now delegates to deployToCloud so
// existing-service redeploys use updateAndRedeployService +
// waitForDeploymentSuccess(previousDeploymentId).
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
  ;(prismaMock.deployment.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 })
  ;(prismaMock.deployment.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ version: 0 })
})

afterEach(() => {
  vi.useRealTimers()
  for (const [k, v] of Object.entries(prevEnv)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
})

describe("redeployWorkspace — honest deploy path", () => {
  it("loads user.apiKeys through deployToCloud and uses updateAndRedeployService for existing services", async () => {
    ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
      workspaceStub({ gatewayToken: "enc-existing-gateway-token" }),
    )
    ;(prismaMock.user.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(userStub())

    await redeployWorkspace("ws-redeploy")

    expect(prismaMock.user.findUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({ include: { apiKeys: true } }),
    )
    expect(mockUpdateServiceVariables).not.toHaveBeenCalled()
    expect(mockRedeployService).not.toHaveBeenCalled()
    expect(mockCreateService).not.toHaveBeenCalled()
    expect(mockUpdateAndRedeployService).toHaveBeenCalledTimes(1)
    expect(mockUpdateAndRedeployService.mock.calls[0][0]).toBe("svc-existing")
  })

  it("derives env through the deploy path for PLATFORM_CREDIT users", async () => {
    ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
      workspaceStub({ gatewayToken: "enc-existing-gateway-token" }),
    )
    ;(prismaMock.user.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
      userStub({ apiKeySource: "PLATFORM_CREDIT" }),
    )

    await redeployWorkspace("ws-redeploy")

    const [, env] = mockUpdateAndRedeployService.mock.calls[0]
    expect(env.CLAWS_CREDIT_MODE).toBe("true")
    expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-master-test")
    expect(env.ANTHROPIC_BASE_URL).toBe("http://localhost:3789")
    expect(env.CLAWS_USER_ID).toBe("user-redeploy")
  })

  it("does not surface BYOK Anthropic keys as Railway vars", async () => {
    ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
      workspaceStub({ gatewayToken: "enc-existing-gateway-token" }),
    )
    ;(prismaMock.user.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
      userStub({
        apiKeySource: "USER_OWN_KEY",
        apiKeys: [{ provider: "ANTHROPIC", encryptedKey: "enc:sk-ant-byok-secret" }],
      }),
    )

    await redeployWorkspace("ws-redeploy")

    const [, env] = mockUpdateAndRedeployService.mock.calls[0]
    expect(env.CLAWS_CREDIT_MODE).toBe("false")
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(env.CLAWS_USER_ID).toBeUndefined()
    expect(JSON.stringify(env)).not.toContain("sk-ant-byok-secret")
  })

  it("MUTATION-anchored: waits for a new Railway deployment id before completing", async () => {
    ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
      workspaceStub({ gatewayToken: "enc-existing-gateway-token" }),
    )
    ;(prismaMock.user.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(userStub())
    mockGetServiceStatus
      .mockResolvedValueOnce({ status: "SUCCESS", deploymentId: "dep-old", healthy: true })
      .mockResolvedValueOnce({ status: "BUILDING", deploymentId: "dep-new", healthy: false })
      .mockResolvedValueOnce({ status: "SUCCESS", deploymentId: "dep-new", healthy: true })

    await redeployWorkspace("ws-redeploy")

    expect(mockGetServiceStatus).toHaveBeenCalledTimes(3)
    const completedCall = (prismaMock.deployment.update as ReturnType<typeof vi.fn>).mock.calls
      .map((call) => call[0])
      .find((call) => call.data.status === "COMPLETED")
    expect(completedCall?.data.configSnapshot).toContain('"railwayDeploymentId":"dep-new"')
  })

  it("Railway FAILED marks Deployment FAILED and preserves Workspace pointers", async () => {
    ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
      workspaceStub({ gatewayToken: "enc-existing-gateway-token" }),
    )
    ;(prismaMock.user.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(userStub())
    mockGetServiceStatus
      .mockResolvedValueOnce({ status: "SUCCESS", deploymentId: "dep-old", healthy: true })
      .mockResolvedValueOnce({ status: "FAILED", deploymentId: "dep-new", healthy: false })

    await expect(redeployWorkspace("ws-redeploy")).rejects.toThrow("Railway deployment FAILED")

    expect(prismaMock.deployment.update).toHaveBeenCalledWith({
      where: { id: "dep-1" },
      data: expect.objectContaining({
        status: "FAILED",
        errorMessage: "Railway deployment FAILED",
      }),
    })
    expect(prismaMock.workspace.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          containerId: null,
          containerHost: null,
        }),
      }),
    )
  })

  it("Railway update timeout marks Deployment FAILED and preserves Workspace pointers", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-05T00:00:00.000Z"))
    ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
      workspaceStub({ gatewayToken: "enc-existing-gateway-token" }),
    )
    ;(prismaMock.user.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(userStub())
    mockGetServiceStatus
      .mockResolvedValueOnce({ status: "SUCCESS", deploymentId: "dep-old", healthy: true })
      .mockResolvedValue({ status: "BUILDING", deploymentId: "dep-new", healthy: false })

    const promise = redeployWorkspace("ws-redeploy")
    const rejection = expect(promise).rejects.toThrow("Railway deployment did not succeed within 120s")
    await vi.advanceTimersByTimeAsync(123_000)

    await rejection
    expect(prismaMock.deployment.update).toHaveBeenCalledWith({
      where: { id: "dep-1" },
      data: expect.objectContaining({
        status: "FAILED",
        errorMessage: "Railway deployment did not succeed within 120s",
      }),
    })
    expect(prismaMock.workspace.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          containerId: null,
          containerHost: null,
        }),
      }),
    )
  })

  it("does not write Workspace.gatewayToken on existing-token redeploys", async () => {
    ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
      workspaceStub({ gatewayToken: "enc-existing-gateway-token" }),
    )
    ;(prismaMock.user.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(userStub())

    await redeployWorkspace("ws-redeploy")

    const workspaceUpdates = (prismaMock.workspace.update as ReturnType<typeof vi.fn>).mock.calls
      .map((call) => call[0])
    expect(workspaceUpdates.some((call) => Object.prototype.hasOwnProperty.call(call.data, "gatewayToken"))).toBe(false)
  })
})
