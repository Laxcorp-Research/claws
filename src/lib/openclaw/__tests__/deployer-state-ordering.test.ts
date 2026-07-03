// PR2.5: timing/ordering assertions for deployToCloud.
//
// The initial-sync race (discovered during PR2 validation): container boots
// ~30 sec after createService, runs its first state sync at t~=30s against
// /api/internal/state/upload which does updateMany. Before this fix, the
// ContainerState row was created ONLY after Railway deploy succeeded (post
// waitForDeploymentSuccess), so the first sync saw count=0 and silently
// discarded its payload.
//
// These tests assert the fix: ContainerState row must be upserted BEFORE
// any Railway service-create / service-redeploy call returns. If anyone
// ever re-orders the code and breaks the race closure again, these tests
// fail loudly.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

const mockCreateService = vi.fn()
const mockUpdateAndRedeployService = vi.fn()
const mockGetServiceStatus = vi.fn()
const mockIsRailwayConfigured = vi.fn()
const mockDeleteService = vi.fn()
const mockFindServiceByName = vi.fn()

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

const mockBuildWorkspaceConfigFingerprint = vi.fn()
vi.mock("@/lib/openclaw/config-fingerprint", () => ({
  buildWorkspaceConfigFingerprint: (...args: unknown[]) => mockBuildWorkspaceConfigFingerprint(...args),
}))

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

vi.mock("@/lib/credits/api-key-source", () => ({
  getApiKeySource: () => "OWN_KEY",
}))

vi.mock("@/lib/composio", () => ({
  getComposioUserId: (id: string) => `composio:${id}`,
}))

import { deployToCloud } from "@/lib/openclaw/deployer"

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
    id: "ws-1",
    userId: "user-1",
    status: "DRAFT",
    containerId: null,
    containerName: null,
    containerHost: null,
    channelConfigEncrypted: null,
    timezone: "UTC",
    ...overrides,
  } as unknown as Parameters<typeof import("@/lib/openclaw/deployer").buildRailwayEnvVars>[1] & {
    id: string
    userId: string
    status: string
    containerId: string | null
  }
}

beforeEach(() => {
  mockCreateService.mockReset()
  mockUpdateAndRedeployService.mockReset()
  mockGetServiceStatus.mockReset()
  mockIsRailwayConfigured.mockReset()
  mockDeleteService.mockReset()
  mockFindServiceByName.mockReset()
  mockGenerateWorkspace.mockReset()
  mockBuildWorkspaceConfigFingerprint.mockReset()

  mockIsRailwayConfigured.mockReturnValue(true)
  mockGenerateWorkspace.mockResolvedValue(generatedStub())
  mockBuildWorkspaceConfigFingerprint.mockResolvedValue({
    hash: "hash-current",
    areas: {
      tools: "tools-hash",
      agents: "agents-hash",
      connections: "connections-hash",
      channels: "channels-hash",
      keys: "keys-hash",
      workspace: "workspace-hash",
    },
  })

  // PR-2b: buildRailwayEnvVars now throws if ACTIVITY_ENDPOINT /
  // METERING_ENDPOINT are unset or host-mismatched with NEXT_PUBLIC_APP_URL.
  // Set a matching staging-shaped triple so tests focused on the
  // create/update ordering don't fail in the env-guard layer. See
  // src/lib/openclaw/env-guards.ts.
  process.env.NEXT_PUBLIC_APP_URL = "https://staging.app.buildclaws.ai"
  process.env.METERING_ENDPOINT = "https://staging.app.buildclaws.ai/api/internal/metering"
  process.env.ACTIVITY_ENDPOINT = "https://staging.app.buildclaws.ai/api/internal/activity"

  // Return the call order index so we can assert "upsert.ts < createService.ts"
  ;(prismaMock.containerState.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "cs-1" })
  ;(prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({})
  ;(prismaMock.deployment.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "dep-1" })
  ;(prismaMock.deployment.update as ReturnType<typeof vi.fn>).mockResolvedValue({})
  ;(prismaMock.deployment.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ version: 0 })
  ;(prismaMock.containerState.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 })
  ;(prismaMock.$transaction as ReturnType<typeof vi.fn>).mockImplementation(async (ops: unknown[]) => ops)
})

describe("deployToCloud initial-sync race closure (PR2.5)", () => {
  it("upserts ContainerState BEFORE Railway createService on first-time deploy", async () => {
    ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
      workspaceStub({ containerId: null }),
    )
    ;(prismaMock.user.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "user-1",
      trialUsed: false,
      apiKeys: [],
    })

    let upsertWhenCreateServiceRan: boolean | null = null
    mockCreateService.mockImplementation(async () => {
      // At the moment createService is invoked, the upsert MUST have
      // already fired. If this captures `false`, the race is open again.
      upsertWhenCreateServiceRan =
        (prismaMock.containerState.upsert as ReturnType<typeof vi.fn>).mock.calls.length > 0
      return { serviceId: "svc-new", domain: "svc-new.up.railway.app" }
    })
    mockGetServiceStatus.mockResolvedValue({ status: "SUCCESS", deploymentId: "dep-rw-1", healthy: true })

    await deployToCloud("ws-1")

    expect(upsertWhenCreateServiceRan).toBe(true)

    // Belt-and-suspenders: assert upsert call order strictly precedes
    // createService call order.
    const upsertOrder = (prismaMock.containerState.upsert as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0]
    const createOrder = mockCreateService.mock.invocationCallOrder[0]
    expect(upsertOrder).toBeLessThan(createOrder)
  })

  it("writes configHash and gzipped config snapshot when deployment completes", async () => {
    ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
      workspaceStub({ containerId: null }),
    )
    ;(prismaMock.user.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "user-1",
      trialUsed: false,
      apiKeys: [],
    })
    mockCreateService.mockResolvedValue({ serviceId: "svc-new", domain: "svc-new.up.railway.app" })
    mockGetServiceStatus.mockResolvedValue({ status: "SUCCESS", deploymentId: "dep-rw-1", healthy: true })

    await deployToCloud("ws-1")

    const completedUpdate = (prismaMock.deployment.update as ReturnType<typeof vi.fn>).mock.calls
      .map((call) => call[0])
      .find((call) => call.data.status === "COMPLETED")
    expect(completedUpdate).toBeTruthy()
    expect(completedUpdate.data.configHash).toBe("hash-current")
    expect(completedUpdate.data.configSnapshot).toContain('"hash":"hash-current"')
    expect(completedUpdate.data.configSnapshotGzip).toBeInstanceOf(Uint8Array)
    expect(completedUpdate.data.configSnapshotGzip.length).toBeGreaterThan(0)
  })

  it("upserts ContainerState BEFORE Railway updateAndRedeployService on redeploy of existing service", async () => {
    ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
      workspaceStub({ containerId: "svc-existing", containerHost: "svc-existing.up.railway.app" }),
    )
    ;(prismaMock.user.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "user-1",
      trialUsed: false,
      apiKeys: [],
    })
    mockGetServiceStatus
      .mockResolvedValueOnce({ status: "SUCCESS", deploymentId: "dep-rw-prev", healthy: true })
      .mockResolvedValueOnce({ status: "SUCCESS", deploymentId: "dep-rw-new", healthy: true })

    let upsertWhenRedeployRan: boolean | null = null
    mockUpdateAndRedeployService.mockImplementation(async () => {
      upsertWhenRedeployRan =
        (prismaMock.containerState.upsert as ReturnType<typeof vi.fn>).mock.calls.length > 0
      return { serviceId: "svc-existing", domain: "svc-existing.up.railway.app" }
    })

    await deployToCloud("ws-1")

    expect(upsertWhenRedeployRan).toBe(true)

    const upsertOrder = (prismaMock.containerState.upsert as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0]
    const redeployOrder = mockUpdateAndRedeployService.mock.invocationCallOrder[0]
    expect(upsertOrder).toBeLessThan(redeployOrder)
  })
})

describe("deployToCloud failure recovery — preserves live container pointers", () => {
  it("does not delete or null the existing service when updateAndRedeployService fails before replacement", async () => {
    ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
      workspaceStub({
        containerId: "svc-existing",
        containerName: "claw-ws-1",
        containerHost: "svc-existing.up.railway.app",
      }),
    )
    ;(prismaMock.user.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "user-1",
      trialUsed: false,
      apiKeys: [],
    })
    mockGetServiceStatus.mockResolvedValue({
      status: "SUCCESS",
      deploymentId: "dep-rw-prev",
      healthy: true,
    })
    mockUpdateAndRedeployService.mockRejectedValue(
      new Error("Railway GraphQL error: Variable 'CLAWS_FILES_B64' value exceeds maximum length of 32768"),
    )

    await expect(deployToCloud("ws-1")).rejects.toThrow(/CLAWS_FILES_B64/)

    expect(mockDeleteService).not.toHaveBeenCalled()
    expect(mockCreateService).not.toHaveBeenCalled()
    expect(prismaMock.workspace.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          containerId: null,
        }),
      }),
    )
    expect(prismaMock.workspace.update).toHaveBeenCalledWith({
      where: { id: "ws-1" },
      data: { status: "ERROR" },
    })
  })

  it("clears a stale missing-service pointer only when replacing it with a fresh service", async () => {
    ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
      workspaceStub({
        containerId: "svc-missing",
        containerName: "claw-ws-1",
        containerHost: "missing.up.railway.app",
      }),
    )
    ;(prismaMock.user.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "user-1",
      trialUsed: false,
      apiKeys: [],
    })
    mockGetServiceStatus.mockResolvedValue({ status: "NO_DEPLOYMENT", deploymentId: null, healthy: false })
    mockUpdateAndRedeployService.mockRejectedValue(new Error("Railway GraphQL error: Service not found"))
    mockFindServiceByName.mockResolvedValue(null)
    mockCreateService.mockResolvedValue({ serviceId: "svc-new", domain: "svc-new.up.railway.app" })
    mockGetServiceStatus.mockResolvedValueOnce({ status: "NO_DEPLOYMENT", deploymentId: null, healthy: false })
    mockGetServiceStatus.mockResolvedValueOnce({ status: "SUCCESS", deploymentId: "dep-rw-new", healthy: true })

    await deployToCloud("ws-1")

    expect(mockDeleteService).not.toHaveBeenCalled()
    expect(prismaMock.workspace.update).toHaveBeenCalledWith({
      where: { id: "ws-1" },
      data: { containerId: null, containerName: null, containerHost: null },
    })
    expect(mockCreateService).toHaveBeenCalledTimes(1)
    expect(prismaMock.workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          containerId: "svc-new",
          containerHost: "svc-new.up.railway.app",
        }),
      }),
    )
  })
})
