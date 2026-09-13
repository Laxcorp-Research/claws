// Governor + deployToCloud: over-cap queues (not ERROR); Railway quota
// backstop enqueues. MUTATION: restore fail-on-cap or ERROR-on-quota → fail.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { RAILWAY_CREATE_QUOTA_WRAPPED } from "@/lib/railway/governor-budget"
import { isProvisioningQueuedError } from "@/lib/railway/governor"

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

vi.mock("@/lib/alerts/critical-alert-push", () => ({
  sendCriticalAlert: vi.fn().mockResolvedValue({ sent: false, channel: "skipped" }),
}))

import { deployToCloud } from "@/lib/openclaw/deployer"

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

beforeEach(() => {
  mockCreateService.mockReset()
  mockUpdateAndRedeployService.mockReset()
  mockGetServiceStatus.mockReset()
  mockIsRailwayConfigured.mockReturnValue(true)
  mockGenerateWorkspace.mockResolvedValue(generatedStub())

  process.env.NEXT_PUBLIC_APP_URL = "https://staging.app.buildclaws.ai"
  process.env.METERING_ENDPOINT = "https://staging.app.buildclaws.ai/api/internal/metering"
  process.env.ACTIVITY_ENDPOINT = "https://staging.app.buildclaws.ai/api/internal/activity"

  ;(prismaMock.containerState.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "cs-1" })
  ;(prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({})
  ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(workspaceStub())
  ;(prismaMock.user.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "user-1",
    trialUsed: false,
    apiKeys: [],
  })
  ;(prismaMock.deployment.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "dep-1" })
  ;(prismaMock.deployment.update as ReturnType<typeof vi.fn>).mockResolvedValue({})
  ;(prismaMock.deployment.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 })
  ;(prismaMock.deployment.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ version: 0 })
  ;(prismaMock.openClawVersion.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
    // Realistic row: `version` is NOT NULL in schema and resolveDeployTarget's
    // contractFromRow reads version + runtimeContract (version-keyed emission).
    dockerImage: "ghcr.io/laxcorp-research/openclaw-runtime:test",
    version: "2026.9.4-5",
    runtimeContract: "9.4",
    releasedAt: new Date(),
  })
  ;(prismaMock.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
    async (ops: unknown) => (Array.isArray(ops) ? Promise.all(ops) : ops),
  )
  ;(prismaMock.railwayGovernorState.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null)
  ;(prismaMock.railwayGovernorState.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "default",
  })
  ;(prismaMock.provisioningQueue.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null)
  ;(prismaMock.provisioningQueue.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({
    workspaceId: "ws-1",
    enqueuedAt: new Date(),
    etaAt: new Date(),
  })
  ;(prismaMock.provisioningQueue.count as ReturnType<typeof vi.fn>).mockResolvedValue(1)
  ;(prismaMock.provisioningQueue.deleteMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 })
  ;(prismaMock.railwayCreateLedger.create as ReturnType<typeof vi.fn>).mockResolvedValue({})
  ;(prismaMock.railwayCreateLedger.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([])
})

describe("deployToCloud + governor", () => {
  it("over-cap → queued, createService never called, workspace is not ERROR", async () => {
    ;(prismaMock.railwayCreateLedger.count as ReturnType<typeof vi.fn>).mockResolvedValue(23)
    ;(prismaMock.railwayCreateLedger.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
      Array.from({ length: 23 }, (_, i) => ({
        createdAt: new Date(Date.now() - i * 60 * 60 * 1000),
      })),
    )

    await expect(deployToCloud("ws-1")).rejects.toSatisfy((err: unknown) =>
      isProvisioningQueuedError(err),
    )
    expect(mockCreateService).not.toHaveBeenCalled()
    expect(prismaMock.workspace.update).toHaveBeenCalledWith({
      where: { id: "ws-1" },
      data: { status: "PROVISIONING_QUEUED" },
    })
    expect(prismaMock.workspace.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "ERROR" }) }),
    )
  })

  it("Railway quota string (req_0d3c2zp4er0t) → enqueue, not ERROR", async () => {
    ;(prismaMock.railwayCreateLedger.count as ReturnType<typeof vi.fn>).mockResolvedValue(0)
    mockCreateService.mockRejectedValue(new Error(RAILWAY_CREATE_QUOTA_WRAPPED))

    await expect(deployToCloud("ws-1")).rejects.toSatisfy((err: unknown) =>
      isProvisioningQueuedError(err),
    )
    expect(mockCreateService).toHaveBeenCalled()
    expect(prismaMock.workspace.update).toHaveBeenCalledWith({
      where: { id: "ws-1" },
      data: { status: "PROVISIONING_QUEUED" },
    })
    expect(prismaMock.workspace.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "ERROR" }) }),
    )
  })

  it("reuse path with containerId never hits createService or the budget gate", async () => {
    ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...workspaceStub(),
      containerId: "svc-keep",
      containerHost: "keep.up.railway.app",
    })
    ;(prismaMock.railwayCreateLedger.count as ReturnType<typeof vi.fn>).mockResolvedValue(23)
    mockGetServiceStatus
      .mockResolvedValueOnce({
        status: "SUCCESS",
        deploymentId: "dep-prev",
        healthy: true,
      })
      .mockResolvedValueOnce({
        status: "SUCCESS",
        deploymentId: "dep-new",
        healthy: true,
      })
    mockUpdateAndRedeployService.mockResolvedValue({
      serviceId: "svc-keep",
      domain: "keep.up.railway.app",
    })

    await deployToCloud("ws-1")
    expect(mockCreateService).not.toHaveBeenCalled()
    expect(mockUpdateAndRedeployService).toHaveBeenCalled()
  })
})
