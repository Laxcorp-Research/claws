// deployToCloud + service pool precedence (Rule-36 rows for the pool):
//   - create-branch checks the pool out FIRST; serviceCreate only when empty
//   - a pooled deploy receives byte-identical envVars + image as a fresh
//     create would (claw deployed from a pooled service boots identically)
//   - governor queues ONLY when pool empty AND cap spent
//   - wake/reuse (containerId set) never consults the pool
// Real service-pool + governor logic run against prismaMock; only
// railway-client and the generator are mocked.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { isProvisioningQueuedError } from "@/lib/railway/governor"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

const mockCreateService = vi.fn()
const mockUpdateAndRedeployService = vi.fn()
const mockGetServiceStatus = vi.fn()
const mockIsRailwayConfigured = vi.fn()
const mockDeleteService = vi.fn()
const mockFindServiceByName = vi.fn()
const mockRenameService = vi.fn()
const mockRemoveLatestDeployment = vi.fn()
const mockUpdateServiceVariables = vi.fn()
const mockListServiceVolumeIds = vi.fn()
const mockDeleteVolume = vi.fn()

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
    renameService: (...args: unknown[]) => mockRenameService(...args),
    removeLatestDeployment: (...args: unknown[]) => mockRemoveLatestDeployment(...args),
    updateServiceVariables: (...args: unknown[]) => mockUpdateServiceVariables(...args),
    listServiceVolumeIds: (...args: unknown[]) => mockListServiceVolumeIds(...args),
    deleteVolume: (...args: unknown[]) => mockDeleteVolume(...args),
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

vi.mock("@/lib/alerts/owner-alert", async () => {
  const actual = await vi.importActual<typeof import("@/lib/alerts/owner-alert")>(
    "@/lib/alerts/owner-alert",
  )
  return {
    ...actual,
    sendOwnerAlert: vi.fn().mockResolvedValue({ sent: false, channel: "skipped" }),
  }
})

import { deployToCloud } from "@/lib/openclaw/deployer"

type MockFn = ReturnType<typeof vi.fn>

function generatedStub() {
  return {
    "openclaw.json": "{}",
    ".env": "",
    "cron/jobs.json": "[]",
    workspaces: {},
    gatewayToken: "gw-token",
  }
}

function workspaceStub() {
  return {
    id: "ws-1",
    userId: "user-1",
    status: "DRAFT",
    containerId: null,
    containerName: null,
    containerHost: null,
    channelConfigEncrypted: null,
    timezone: "UTC",
    gatewayToken: null,
  }
}

function readyPoolRow() {
  return {
    id: "pe-1",
    serviceId: "svc-pool-1",
    domain: "banked.up.railway.app",
    state: "READY",
    workspaceId: null,
    lastError: null,
    assignedAt: null,
    recycledAt: null,
    createdAt: new Date("2026-09-10T00:00:00Z"),
    updatedAt: new Date("2026-09-10T00:00:00Z"),
  }
}

/** Pool has one READY entry: reclaim probe -> null, claim probe -> the row. */
function stubPoolWithOneReadyEntry() {
  ;(prismaMock.servicePool.findFirst as MockFn)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(readyPoolRow())
  ;(prismaMock.servicePool.updateMany as MockFn).mockResolvedValue({ count: 1 })
}

function stubEmptyPool() {
  ;(prismaMock.servicePool.findFirst as MockFn).mockResolvedValue(null)
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.SERVICE_POOL_ENABLED
  mockIsRailwayConfigured.mockReturnValue(true)
  mockGenerateWorkspace.mockResolvedValue(generatedStub())
  mockRenameService.mockResolvedValue(undefined)
  mockRemoveLatestDeployment.mockResolvedValue(null)
  mockUpdateServiceVariables.mockResolvedValue(undefined)
  mockListServiceVolumeIds.mockResolvedValue([])
  mockDeleteVolume.mockResolvedValue(undefined)

  process.env.NEXT_PUBLIC_APP_URL = "https://staging.app.buildclaws.ai"
  process.env.METERING_ENDPOINT = "https://staging.app.buildclaws.ai/api/internal/metering"
  process.env.ACTIVITY_ENDPOINT = "https://staging.app.buildclaws.ai/api/internal/activity"

  ;(prismaMock.containerState.upsert as MockFn).mockResolvedValue({ id: "cs-1" })
  ;(prismaMock.containerState.updateMany as MockFn).mockResolvedValue({ count: 1 })
  ;(prismaMock.workspace.update as MockFn).mockResolvedValue({})
  ;(prismaMock.workspace.findUniqueOrThrow as MockFn).mockResolvedValue(workspaceStub())
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
  ;(prismaMock.$transaction as MockFn).mockImplementation(
    async (ops: unknown) => (Array.isArray(ops) ? Promise.all(ops) : ops),
  )
  ;(prismaMock.railwayGovernorState.findUnique as MockFn).mockResolvedValue(null)
  ;(prismaMock.railwayGovernorState.upsert as MockFn).mockResolvedValue({ id: "default" })
  ;(prismaMock.provisioningQueue.findUnique as MockFn).mockResolvedValue(null)
  ;(prismaMock.provisioningQueue.upsert as MockFn).mockResolvedValue({
    workspaceId: "ws-1",
    enqueuedAt: new Date(),
    etaAt: new Date(),
  })
  ;(prismaMock.provisioningQueue.count as MockFn).mockResolvedValue(1)
  ;(prismaMock.provisioningQueue.deleteMany as MockFn).mockResolvedValue({ count: 0 })
  ;(prismaMock.railwayCreateLedger.create as MockFn).mockResolvedValue({})
  ;(prismaMock.railwayCreateLedger.count as MockFn).mockResolvedValue(0)
  ;(prismaMock.railwayCreateLedger.findMany as MockFn).mockResolvedValue([])
  ;(prismaMock.servicePool.update as MockFn).mockResolvedValue(readyPoolRow())
})

describe("deployToCloud + service pool", () => {
  it("create-branch checks out the pool FIRST: serviceCreate never called when a READY entry exists", async () => {
    stubPoolWithOneReadyEntry()
    mockGetServiceStatus
      // provisionFreshService beforeStatus probe on the pooled service
      .mockResolvedValueOnce({ status: "NO_DEPLOYMENT", deploymentId: null, healthy: false })
      // waitForDeploymentSuccess: the new deployment lands
      .mockResolvedValueOnce({ status: "SUCCESS", deploymentId: "dep-new", healthy: true })
    mockUpdateAndRedeployService.mockResolvedValue({
      serviceId: "svc-pool-1",
      domain: "banked.up.railway.app",
    })

    const result = await deployToCloud("ws-1")

    expect(result.containerId).toBe("svc-pool-1")
    expect(mockCreateService).not.toHaveBeenCalled()
    expect(mockRenameService).toHaveBeenCalledWith("svc-pool-1", "claw-ws-1")
    expect(mockUpdateAndRedeployService).toHaveBeenCalledWith(
      "svc-pool-1",
      expect.any(Object),
      "ghcr.io/laxcorp-research/openclaw-runtime:test",
      "banked.up.railway.app",
    )
    // Workspace binds to the pooled service like any other.
    expect(prismaMock.workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ containerId: "svc-pool-1" }),
      }),
    )
  })

  it("Rule-36 boots identically: pooled deploy passes byte-identical envVars + image as a fresh create", async () => {
    // Deploy 1: empty pool -> createService captures the fresh-create config.
    stubEmptyPool()
    mockCreateService.mockResolvedValue({ serviceId: "svc-fresh", domain: "fresh.up.railway.app" })
    mockGetServiceStatus.mockResolvedValue({
      status: "SUCCESS",
      deploymentId: "dep-1",
      healthy: true,
    })
    await deployToCloud("ws-1")
    expect(mockCreateService).toHaveBeenCalledTimes(1)
    const freshConfig = mockCreateService.mock.calls[0][0] as {
      name: string
      envVars: Record<string, string>
      image: string
    }

    // Deploy 2: same workspace, pool has a READY entry.
    vi.clearAllMocks()
    mockIsRailwayConfigured.mockReturnValue(true)
    mockGenerateWorkspace.mockResolvedValue(generatedStub())
    mockRenameService.mockResolvedValue(undefined)
    ;(prismaMock.workspace.findUniqueOrThrow as MockFn).mockResolvedValue(workspaceStub())
    ;(prismaMock.user.findUniqueOrThrow as MockFn).mockResolvedValue({
      id: "user-1",
      trialUsed: false,
      apiKeys: [],
    })
    ;(prismaMock.deployment.create as MockFn).mockResolvedValue({ id: "dep-2" })
    ;(prismaMock.deployment.update as MockFn).mockResolvedValue({})
    ;(prismaMock.deployment.updateMany as MockFn).mockResolvedValue({ count: 0 })
    ;(prismaMock.deployment.findFirst as MockFn).mockResolvedValue({ version: 1 })
    ;(prismaMock.openClawVersion.findFirst as MockFn).mockResolvedValue({
      dockerImage: "ghcr.io/laxcorp-research/openclaw-runtime:test",
      version: "2026.9.4-5",
      runtimeContract: "9.4",
      releasedAt: new Date(),
    })
    ;(prismaMock.containerState.upsert as MockFn).mockResolvedValue({ id: "cs-1" })
    ;(prismaMock.workspace.update as MockFn).mockResolvedValue({})
    ;(prismaMock.$transaction as MockFn).mockImplementation(
      async (ops: unknown) => (Array.isArray(ops) ? Promise.all(ops) : ops),
    )
    ;(prismaMock.railwayCreateLedger.count as MockFn).mockResolvedValue(0)
    ;(prismaMock.railwayCreateLedger.findMany as MockFn).mockResolvedValue([])
    ;(prismaMock.railwayGovernorState.findUnique as MockFn).mockResolvedValue(null)
    stubPoolWithOneReadyEntry()
    mockGetServiceStatus
      .mockResolvedValueOnce({ status: "NO_DEPLOYMENT", deploymentId: null, healthy: false })
      .mockResolvedValueOnce({ status: "SUCCESS", deploymentId: "dep-new", healthy: true })
    mockUpdateAndRedeployService.mockResolvedValue({
      serviceId: "svc-pool-1",
      domain: "banked.up.railway.app",
    })

    await deployToCloud("ws-1")

    const [, pooledEnvVars, pooledImage] = mockUpdateAndRedeployService.mock.calls[0] as [
      string,
      Record<string, string>,
      string,
      string,
    ]
    // Identical boot config: same env payloads (config, files, boot script,
    // gateway token, endpoints) and the same resolved image.
    expect(pooledEnvVars).toEqual(freshConfig.envVars)
    expect(pooledImage).toBe(freshConfig.image)
  })

  it("governor queues ONLY when pool empty AND cap spent: pooled entry deploys despite spent cap", async () => {
    // Cap fully spent on the ledger.
    ;(prismaMock.railwayCreateLedger.count as MockFn).mockResolvedValue(23)
    ;(prismaMock.railwayCreateLedger.findMany as MockFn).mockResolvedValue(
      Array.from({ length: 23 }, (_, i) => ({
        createdAt: new Date(Date.now() - i * 60 * 60 * 1000),
      })),
    )
    stubPoolWithOneReadyEntry()
    mockGetServiceStatus
      .mockResolvedValueOnce({ status: "NO_DEPLOYMENT", deploymentId: null, healthy: false })
      .mockResolvedValueOnce({ status: "SUCCESS", deploymentId: "dep-new", healthy: true })
    mockUpdateAndRedeployService.mockResolvedValue({
      serviceId: "svc-pool-1",
      domain: "banked.up.railway.app",
    })

    const result = await deployToCloud("ws-1")

    expect(result.containerId).toBe("svc-pool-1")
    expect(mockCreateService).not.toHaveBeenCalled()
    expect(prismaMock.workspace.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "PROVISIONING_QUEUED" }),
      }),
    )
  })

  it("pool empty AND cap spent -> ProvisioningQueuedError (regression: queue still guards serviceCreate)", async () => {
    ;(prismaMock.railwayCreateLedger.count as MockFn).mockResolvedValue(23)
    ;(prismaMock.railwayCreateLedger.findMany as MockFn).mockResolvedValue(
      Array.from({ length: 23 }, (_, i) => ({
        createdAt: new Date(Date.now() - i * 60 * 60 * 1000),
      })),
    )
    stubEmptyPool()

    await expect(deployToCloud("ws-1")).rejects.toSatisfy((err: unknown) =>
      isProvisioningQueuedError(err),
    )
    expect(mockCreateService).not.toHaveBeenCalled()
    expect(prismaMock.workspace.update).toHaveBeenCalledWith({
      where: { id: "ws-1" },
      data: { status: "PROVISIONING_QUEUED" },
    })
  })

  it("dead pooled service (orphan error) -> entry released for sweep, deploy falls back to serviceCreate", async () => {
    stubPoolWithOneReadyEntry()
    mockGetServiceStatus
      // provisionFreshService beforeStatus probe (pooled attempt)
      .mockResolvedValueOnce({ status: "NO_DEPLOYMENT", deploymentId: null, healthy: false })
      // waitForDeploymentSuccess after fallback create
      .mockResolvedValueOnce({ status: "SUCCESS", deploymentId: "dep-1", healthy: true })
    mockUpdateAndRedeployService.mockRejectedValue(new Error("Service not found"))
    mockCreateService.mockResolvedValue({ serviceId: "svc-fresh", domain: "fresh.up.railway.app" })

    const result = await deployToCloud("ws-1")

    expect(result.containerId).toBe("svc-fresh")
    expect(prismaMock.servicePool.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "pe-1" },
        data: expect.objectContaining({ state: "RECYCLING" }),
      }),
    )
  })

  it("wake/reuse path (containerId set - incl. pooled-origin service) never consults the pool", async () => {
    ;(prismaMock.workspace.findUniqueOrThrow as MockFn).mockResolvedValue({
      ...workspaceStub(),
      containerId: "svc-pool-1", // service originally came from the pool
      containerHost: "banked.up.railway.app",
    })
    mockGetServiceStatus
      .mockResolvedValueOnce({ status: "REMOVED", deploymentId: null, healthy: false })
      .mockResolvedValueOnce({ status: "SUCCESS", deploymentId: "dep-wake", healthy: true })
    mockUpdateAndRedeployService.mockResolvedValue({
      serviceId: "svc-pool-1",
      domain: "banked.up.railway.app",
    })

    await deployToCloud("ws-1", { forbidCreate: true })

    expect(prismaMock.servicePool.findFirst).not.toHaveBeenCalled()
    expect(mockCreateService).not.toHaveBeenCalled()
    expect(mockUpdateAndRedeployService).toHaveBeenCalledWith(
      "svc-pool-1",
      expect.any(Object),
      expect.any(String),
      "banked.up.railway.app",
    )
  })
})
