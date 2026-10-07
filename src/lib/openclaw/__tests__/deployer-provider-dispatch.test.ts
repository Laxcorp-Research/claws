// Provider dispatch seams: Workspace.provider routes deploy / hibernate-stop
// / terminal teardown / restart to the right cloud. RAILWAY path stays
// byte-identical (regression: FLY dispatch must not perturb it).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

const mockCreateService = vi.fn()
const mockUpdateAndRedeployService = vi.fn()
const mockGetServiceStatus = vi.fn()
const mockIsRailwayConfigured = vi.fn()
const mockRemoveLatestDeployment = vi.fn()
const mockRenameService = vi.fn()
const mockUpdateServiceVariables = vi.fn()
const mockListServiceVolumeIds = vi.fn()
const mockDeleteVolume = vi.fn()
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
    removeLatestDeployment: (...args: unknown[]) => mockRemoveLatestDeployment(...args),
    renameService: (...args: unknown[]) => mockRenameService(...args),
    updateServiceVariables: (...args: unknown[]) => mockUpdateServiceVariables(...args),
    listServiceVolumeIds: (...args: unknown[]) => mockListServiceVolumeIds(...args),
    deleteVolume: (...args: unknown[]) => mockDeleteVolume(...args),
    deleteService: (...args: unknown[]) => mockDeleteService(...args),
    findServiceByName: (...args: unknown[]) => mockFindServiceByName(...args),
  }
})

const mockDeployToFly = vi.fn()
const mockStopFlyMachineKeepApp = vi.fn()
const mockDestroyFlyWorkspace = vi.fn()
const mockRestartFlyWorkspace = vi.fn()
vi.mock("@/lib/fly/fly-deployer", () => ({
  deployToFly: (...args: unknown[]) => mockDeployToFly(...args),
  stopFlyMachineKeepApp: (...args: unknown[]) => mockStopFlyMachineKeepApp(...args),
  destroyFlyWorkspace: (...args: unknown[]) => mockDestroyFlyWorkspace(...args),
  restartFlyWorkspace: (...args: unknown[]) => mockRestartFlyWorkspace(...args),
}))

const mockIsFlyConfigured = vi.fn()
vi.mock("@/lib/fly/machines-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/fly/machines-client")>(
    "@/lib/fly/machines-client",
  )
  return {
    ...actual,
    isFlyConfigured: () => mockIsFlyConfigured(),
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
  getComposioUserId: (id: string) => `composio:${id}`,
}))

import {
  deployToCloud,
  destroyContainer,
  removeDeploymentKeepService,
  restartContainer,
} from "@/lib/openclaw/deployer"

type MockFn = ReturnType<typeof vi.fn>

function workspaceStub(overrides: Record<string, unknown> = {}) {
  return {
    id: "ws-1",
    userId: "user-1",
    status: "DRAFT",
    provider: "RAILWAY",
    containerId: null,
    containerName: null,
    containerHost: null,
    channelConfigEncrypted: null,
    timezone: "UTC",
    gatewayToken: null,
    candidateRuntimeSoak: false,
    runtimeImagePin: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.NEW_WORKSPACE_PROVIDER
  delete process.env.SERVICE_POOL_ENABLED
  mockIsRailwayConfigured.mockReturnValue(true)
  mockIsFlyConfigured.mockReturnValue(true)
  mockDeployToFly.mockResolvedValue({
    deploymentId: "dep-fly",
    containerId: "mach-1",
    gatewayToken: "gw",
  })
  mockStopFlyMachineKeepApp.mockResolvedValue(undefined)
  mockDestroyFlyWorkspace.mockResolvedValue("destroyed")
  mockRestartFlyWorkspace.mockResolvedValue(undefined)
  ;(prismaMock.workspace.update as MockFn).mockResolvedValue({})
  ;(prismaMock.containerState.updateMany as MockFn).mockResolvedValue({ count: 1 })
  ;(prismaMock.$transaction as MockFn).mockImplementation(
    async (ops: unknown) => (Array.isArray(ops) ? Promise.all(ops) : ops),
  )
})

afterEach(() => {
  delete process.env.NEW_WORKSPACE_PROVIDER
})

describe("deployToCloud provider front door", () => {
  it("provider=FLY delegates to deployToFly; Railway client + governor untouched", async () => {
    ;(prismaMock.workspace.findUniqueOrThrow as MockFn).mockResolvedValue(
      workspaceStub({ provider: "FLY" }),
    )

    const result = await deployToCloud("ws-1", { forbidCreate: true })

    expect(mockDeployToFly).toHaveBeenCalledWith("ws-1", { forbidCreate: true })
    expect(result.containerId).toBe("mach-1")
    expect(mockCreateService).not.toHaveBeenCalled()
    expect(mockUpdateAndRedeployService).not.toHaveBeenCalled()
    expect(prismaMock.railwayCreateLedger.count).not.toHaveBeenCalled()
    // No Railway Deployment row was created by the front door - Fly owns it.
    expect(prismaMock.deployment.create).not.toHaveBeenCalled()
  })

  it("NEW_WORKSPACE_PROVIDER=FLY is ignored (Fly track cancelled)", async () => {
    const { newWorkspaceProviderFlag } = await import("@/lib/fly/provider")
    expect(newWorkspaceProviderFlag("FLY")).toBe("RAILWAY")
    expect(mockDeployToFly).not.toHaveBeenCalled()
  })

  it("NEW_WORKSPACE_PROVIDER=FLY leaves EXISTING claws on Railway (migrate on natural wake only)", async () => {
    process.env.NEW_WORKSPACE_PROVIDER = "FLY"
    ;(prismaMock.workspace.findUniqueOrThrow as MockFn).mockResolvedValue(
      workspaceStub({ containerId: "svc-existing", containerHost: "x.up.railway.app" }),
    )
    mockGenerateWorkspace.mockResolvedValue({
      "openclaw.json": "{}",
      ".env": "",
      "cron/jobs.json": "[]",
      workspaces: {},
      gatewayToken: "gw-token",
    })
    process.env.METERING_ENDPOINT = "https://staging.app.buildclaws.ai/api/internal/metering"
    process.env.ACTIVITY_ENDPOINT = "https://staging.app.buildclaws.ai/api/internal/activity"
    process.env.NEXT_PUBLIC_APP_URL = "https://staging.app.buildclaws.ai"
    ;(prismaMock.user.findUniqueOrThrow as MockFn).mockResolvedValue({
      id: "user-1",
      trialUsed: false,
      apiKeys: [],
    })
    ;(prismaMock.deployment.create as MockFn).mockResolvedValue({ id: "dep-1" })
    ;(prismaMock.deployment.update as MockFn).mockResolvedValue({})
    ;(prismaMock.deployment.updateMany as MockFn).mockResolvedValue({ count: 0 })
    ;(prismaMock.deployment.findFirst as MockFn).mockResolvedValue({ version: 0 })
    ;(prismaMock.openClawVersion.findFirst as MockFn).mockResolvedValue({
      dockerImage: "ghcr.io/laxcorp-research/openclaw-runtime:test",
      version: "2026.9.4-5",
      runtimeContract: "9.4",
      releasedAt: new Date(),
    })
    ;(prismaMock.containerState.upsert as MockFn).mockResolvedValue({ id: "cs-1" })
    mockGetServiceStatus
      .mockResolvedValueOnce({ status: "SUCCESS", deploymentId: "dep-prev", healthy: true })
      .mockResolvedValueOnce({ status: "SUCCESS", deploymentId: "dep-new", healthy: true })
    mockUpdateAndRedeployService.mockResolvedValue({
      serviceId: "svc-existing",
      domain: "x.up.railway.app",
    })

    await deployToCloud("ws-1")

    expect(mockDeployToFly).not.toHaveBeenCalled()
    expect(mockUpdateAndRedeployService).toHaveBeenCalled()
  })
})

describe("hibernate stop dispatch (removeDeploymentKeepService)", () => {
  it("FLY: native machine stop - app/domain/ids persist; Railway teardown untouched", async () => {
    ;(prismaMock.workspace.findUniqueOrThrow as MockFn).mockResolvedValue(
      workspaceStub({ provider: "FLY", containerId: "mach-1", containerName: "claw-ws-1" }),
    )

    await removeDeploymentKeepService("ws-1")

    expect(mockStopFlyMachineKeepApp).toHaveBeenCalledWith(
      expect.objectContaining({ containerId: "mach-1", containerName: "claw-ws-1" }),
    )
    expect(mockRemoveLatestDeployment).not.toHaveBeenCalled()
  })

  it("RAILWAY: deploymentRemove(latest) exactly as before", async () => {
    ;(prismaMock.workspace.findUniqueOrThrow as MockFn).mockResolvedValue(
      workspaceStub({ containerId: "svc-1" }),
    )

    await removeDeploymentKeepService("ws-1")

    expect(mockRemoveLatestDeployment).toHaveBeenCalledWith("svc-1")
    expect(mockStopFlyMachineKeepApp).not.toHaveBeenCalled()
  })
})

describe("terminal teardown dispatch (destroyContainer)", () => {
  it("FLY: machine+app destroy; the Railway service pool is never touched", async () => {
    ;(prismaMock.workspace.findUniqueOrThrow as MockFn).mockResolvedValue(
      workspaceStub({ provider: "FLY", containerId: "mach-1", containerName: "claw-ws-1" }),
    )

    await destroyContainer("ws-1")

    expect(mockDestroyFlyWorkspace).toHaveBeenCalled()
    expect(prismaMock.servicePool.upsert).not.toHaveBeenCalled()
    expect(mockDeleteService).not.toHaveBeenCalled()
    expect(prismaMock.workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "STOPPED", containerId: null }),
      }),
    )
  })

  it("FLY survived outcome keeps container binding (same survive semantics as Railway)", async () => {
    ;(prismaMock.workspace.findUniqueOrThrow as MockFn).mockResolvedValue(
      workspaceStub({
        provider: "FLY",
        containerId: "mach-1",
        containerName: "claw-ws-1",
        containerHost: "claw-ws-1.fly.dev",
      }),
    )
    mockDestroyFlyWorkspace.mockResolvedValue("survived")

    await destroyContainer("ws-1")

    expect(prismaMock.workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          containerId: "mach-1",
          containerHost: "claw-ws-1.fly.dev",
        }),
      }),
    )
  })
})

describe("restart dispatch", () => {
  it("FLY: machine restart endpoint; Railway redeploy untouched", async () => {
    ;(prismaMock.workspace.findUniqueOrThrow as MockFn).mockResolvedValue(
      workspaceStub({ provider: "FLY", containerId: "mach-1", containerName: "claw-ws-1" }),
    )

    await restartContainer("ws-1")

    expect(mockRestartFlyWorkspace).toHaveBeenCalled()
    expect(prismaMock.workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "RUNNING" }) }),
    )
  })
})
