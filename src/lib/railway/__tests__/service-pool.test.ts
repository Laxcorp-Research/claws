// Service pool: checkout CAS, recycle privacy receipts, refill governor
// headroom, low-watermark alert ramp mute.
//
// PRIVACY MUTATIONS locked here:
//   - a volume surviving recycle -> row NEVER flips READY ("prior volume on a
//     recycled service -> fails")
//   - dropping the refill headroom subtraction -> refillPlan overspends the
//     governor budget test fails
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

const mockRenameService = vi.fn()
const mockRemoveLatestDeployment = vi.fn()
const mockUpdateServiceVariables = vi.fn()
const mockListServiceVolumeIds = vi.fn()
const mockDeleteVolume = vi.fn()
const mockDeleteService = vi.fn()
const mockCreateEmptyPooledService = vi.fn()
const mockCountProjectServices = vi.fn()
const mockIsRailwayConfigured = vi.fn()

vi.mock("@/lib/openclaw/railway-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/openclaw/railway-client")>(
    "@/lib/openclaw/railway-client",
  )
  return {
    ...actual,
    renameService: (...args: unknown[]) => mockRenameService(...args),
    removeLatestDeployment: (...args: unknown[]) => mockRemoveLatestDeployment(...args),
    updateServiceVariables: (...args: unknown[]) => mockUpdateServiceVariables(...args),
    listServiceVolumeIds: (...args: unknown[]) => mockListServiceVolumeIds(...args),
    deleteVolume: (...args: unknown[]) => mockDeleteVolume(...args),
    deleteService: (...args: unknown[]) => mockDeleteService(...args),
    createEmptyPooledService: (...args: unknown[]) => mockCreateEmptyPooledService(...args),
    countProjectServices: (...args: unknown[]) => mockCountProjectServices(...args),
    isRailwayConfigured: () => mockIsRailwayConfigured(),
  }
})

const mockSendOwnerAlert = vi.fn()
vi.mock("@/lib/alerts/owner-alert", async () => {
  const actual = await vi.importActual<typeof import("@/lib/alerts/owner-alert")>(
    "@/lib/alerts/owner-alert",
  )
  return {
    ...actual,
    sendOwnerAlert: (...args: unknown[]) => mockSendOwnerAlert(...args),
  }
})

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import {
  checkoutPooledService,
  recycleServiceIntoPool,
  teardownServiceViaPool,
  refillPlan,
  refillServicePoolTick,
  POOL_WIPE_MARKER,
  POOL_LEDGER_WORKSPACE_ID,
} from "@/lib/railway/service-pool"

type MockFn = ReturnType<typeof vi.fn>

function poolRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "pe-1",
    serviceId: "svc-pool-1",
    domain: "pool-1.up.railway.app",
    state: "READY",
    workspaceId: null,
    lastError: null,
    assignedAt: null,
    recycledAt: null,
    createdAt: new Date("2026-09-10T00:00:00Z"),
    updatedAt: new Date("2026-09-10T00:00:00Z"),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.SERVICE_POOL_ENABLED
  delete process.env.SERVICE_POOL_TARGET
  delete process.env.SERVICE_POOL_REFILL_HEADROOM
  delete process.env.SERVICE_POOL_LOW_WATERMARK
  delete process.env.SERVICE_POOL_PROJECT_CEILING
  delete process.env.SERVICE_POOL_REFILL_BATCH
  mockIsRailwayConfigured.mockReturnValue(true)
  mockRenameService.mockResolvedValue(undefined)
  mockRemoveLatestDeployment.mockResolvedValue(null)
  mockUpdateServiceVariables.mockResolvedValue(undefined)
  mockListServiceVolumeIds.mockResolvedValue([])
  mockDeleteVolume.mockResolvedValue(undefined)
  mockDeleteService.mockResolvedValue(undefined)
  ;(prismaMock.servicePool.update as MockFn).mockResolvedValue(poolRow())
  ;(prismaMock.servicePool.updateMany as MockFn).mockResolvedValue({ count: 1 })
  ;(prismaMock.servicePool.upsert as MockFn).mockResolvedValue(poolRow({ state: "RECYCLING" }))
  ;(prismaMock.servicePool.delete as MockFn).mockResolvedValue(poolRow())
  ;(prismaMock.servicePool.findFirst as MockFn).mockResolvedValue(null)
  ;(prismaMock.servicePool.findMany as MockFn).mockResolvedValue([])
  ;(prismaMock.servicePool.count as MockFn).mockResolvedValue(0)
  ;(prismaMock.servicePool.create as MockFn).mockResolvedValue(poolRow())
  ;(prismaMock.servicePoolMeta.upsert as MockFn).mockResolvedValue({
    id: "default",
    highWatermark: 0,
    lowAlertSentAt: null,
    updatedAt: new Date(),
  })
  ;(prismaMock.servicePoolMeta.update as MockFn).mockResolvedValue({})
})

afterEach(() => {
  delete process.env.SERVICE_POOL_ENABLED
})

// ---------------------------------------------------------------------------
// checkout
// ---------------------------------------------------------------------------

describe("checkoutPooledService", () => {
  it("claims the oldest READY entry (CAS) and renames it to the claw service name", async () => {
    ;(prismaMock.servicePool.findFirst as MockFn)
      .mockResolvedValueOnce(null) // no prior ASSIGNED for workspace
      .mockResolvedValueOnce(poolRow())

    const out = await checkoutPooledService("ws-1", "claw-ws-1")

    expect(out).toEqual({
      entryId: "pe-1",
      serviceId: "svc-pool-1",
      domain: "pool-1.up.railway.app",
    })
    expect(prismaMock.servicePool.updateMany).toHaveBeenCalledWith({
      where: { id: "pe-1", state: "READY" },
      data: expect.objectContaining({ state: "ASSIGNED", workspaceId: "ws-1" }),
    })
    expect(mockRenameService).toHaveBeenCalledWith("svc-pool-1", "claw-ws-1")
  })

  it("returns null when the pool has no READY entry (deploy falls back to serviceCreate)", async () => {
    ;(prismaMock.servicePool.findFirst as MockFn).mockResolvedValue(null)
    const out = await checkoutPooledService("ws-1", "claw-ws-1")
    expect(out).toBeNull()
    expect(mockRenameService).not.toHaveBeenCalled()
  })

  it("CAS race lost (updateMany count 0) -> tries the next READY candidate", async () => {
    ;(prismaMock.servicePool.findFirst as MockFn)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(poolRow({ id: "pe-1", serviceId: "svc-a" }))
      .mockResolvedValueOnce(poolRow({ id: "pe-2", serviceId: "svc-b" }))
    ;(prismaMock.servicePool.updateMany as MockFn)
      .mockResolvedValueOnce({ count: 0 }) // raced
      .mockResolvedValueOnce({ count: 1 })

    const out = await checkoutPooledService("ws-1", "claw-ws-1")
    expect(out?.serviceId).toBe("svc-b")
  })

  it("rename failure releases the entry to RECYCLING and claims the next", async () => {
    ;(prismaMock.servicePool.findFirst as MockFn)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(poolRow({ id: "pe-1", serviceId: "svc-dead" }))
      .mockResolvedValueOnce(poolRow({ id: "pe-2", serviceId: "svc-live" }))
    mockRenameService
      .mockRejectedValueOnce(new Error("Not Found"))
      .mockResolvedValueOnce(undefined)

    const out = await checkoutPooledService("ws-1", "claw-ws-1")

    expect(out?.serviceId).toBe("svc-live")
    expect(prismaMock.servicePool.update).toHaveBeenCalledWith({
      where: { id: "pe-1" },
      data: expect.objectContaining({ state: "RECYCLING", workspaceId: null }),
    })
  })

  it("reclaims an entry already ASSIGNED to this workspace (deploy retry idempotence)", async () => {
    ;(prismaMock.servicePool.findFirst as MockFn).mockResolvedValueOnce(
      poolRow({ id: "pe-mine", serviceId: "svc-mine", state: "ASSIGNED", workspaceId: "ws-1" }),
    )

    const out = await checkoutPooledService("ws-1", "claw-ws-1")

    expect(out?.serviceId).toBe("svc-mine")
    // No new claim happened.
    expect(prismaMock.servicePool.updateMany).not.toHaveBeenCalled()
  })

  it("SERVICE_POOL_ENABLED=false -> null without touching the DB", async () => {
    process.env.SERVICE_POOL_ENABLED = "false"
    const out = await checkoutPooledService("ws-1", "claw-ws-1")
    expect(out).toBeNull()
    expect(prismaMock.servicePool.findFirst).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// recycle (privacy receipts)
// ---------------------------------------------------------------------------

describe("recycleServiceIntoPool", () => {
  it("receipts: deployment removed + env replaced with wipe marker + renamed pool-* + READY", async () => {
    const result = await recycleServiceIntoPool({ serviceId: "svc-1", workspaceId: "ws-1" })

    expect(result).toEqual({ outcome: "recycled" })
    expect(mockRemoveLatestDeployment).toHaveBeenCalledWith("svc-1")
    // Env wipe is replace:true with ONLY the marker - no tenant key survives.
    expect(mockUpdateServiceVariables).toHaveBeenCalledWith("svc-1", POOL_WIPE_MARKER)
    expect(mockRenameService).toHaveBeenCalledWith("svc-1", expect.stringMatching(/^pool-/))
    expect(prismaMock.servicePool.update).toHaveBeenCalledWith({
      where: { id: "pe-1" },
      data: expect.objectContaining({ state: "READY", workspaceId: null }),
    })
  })

  it("destroys attached volumes and verifies zero remain before READY", async () => {
    mockListServiceVolumeIds
      .mockResolvedValueOnce(["vol-1", "vol-2"]) // initial list
      .mockResolvedValueOnce([]) // verify after destroy

    const result = await recycleServiceIntoPool({ serviceId: "svc-1", workspaceId: "ws-1" })

    expect(result).toEqual({ outcome: "recycled" })
    expect(mockDeleteVolume).toHaveBeenCalledWith("vol-1")
    expect(mockDeleteVolume).toHaveBeenCalledWith("vol-2")
  })

  it("PRIVACY: volume destroy fails -> stays RECYCLING, never READY (prior volume on a recycled service -> fails)", async () => {
    mockListServiceVolumeIds.mockResolvedValue(["vol-tenant-data"])
    mockDeleteVolume.mockRejectedValue(new Error("volumeDelete refused"))

    const result = await recycleServiceIntoPool({ serviceId: "svc-1", workspaceId: "ws-1" })

    expect(result.outcome).toBe("deferred")
    // lastError persisted for the sweeper; the READY flip never happened.
    const updates = (prismaMock.servicePool.update as MockFn).mock.calls
    expect(
      updates.some(
        (c) => (c[0] as { data?: { state?: string } }).data?.state === "READY",
      ),
    ).toBe(false)
    expect(mockRenameService).not.toHaveBeenCalled()
  })

  it("PRIVACY: volume survives the destroy (re-list non-empty) -> deferred, never READY", async () => {
    mockListServiceVolumeIds
      .mockResolvedValueOnce(["vol-1"])
      .mockResolvedValueOnce(["vol-1"]) // still there after volumeDelete
    mockDeleteVolume.mockResolvedValue(undefined)

    const result = await recycleServiceIntoPool({ serviceId: "svc-1", workspaceId: "ws-1" })

    expect(result.outcome).toBe("deferred")
    const updates = (prismaMock.servicePool.update as MockFn).mock.calls
    expect(
      updates.some(
        (c) => (c[0] as { data?: { state?: string } }).data?.state === "READY",
      ),
    ).toBe(false)
  })

  it("env wipe failure -> deferred with lastError (sweeper retries)", async () => {
    mockUpdateServiceVariables.mockRejectedValue(new Error("boom"))
    const result = await recycleServiceIntoPool({ serviceId: "svc-1" })
    expect(result.outcome).toBe("deferred")
    expect(prismaMock.servicePool.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastError: expect.stringContaining("env-wipe") }),
      }),
    )
  })

  it("service already gone on Railway -> entry dropped, outcome missing", async () => {
    mockRemoveLatestDeployment.mockRejectedValue(new Error("Service not found"))
    const result = await recycleServiceIntoPool({ serviceId: "svc-gone" })
    expect(result).toEqual({ outcome: "missing" })
    expect(prismaMock.servicePool.delete).toHaveBeenCalledWith({ where: { id: "pe-1" } })
  })
})

// ---------------------------------------------------------------------------
// teardownServiceViaPool (destroyContainer entry point)
// ---------------------------------------------------------------------------

describe("teardownServiceViaPool", () => {
  it("pool enabled -> recycled; serviceDelete never called", async () => {
    const outcome = await teardownServiceViaPool({ serviceId: "svc-1", workspaceId: "ws-1" })
    expect(outcome).toBe("recycled")
    expect(mockDeleteService).not.toHaveBeenCalled()
  })

  it("pool disabled -> legacy serviceDelete", async () => {
    process.env.SERVICE_POOL_ENABLED = "false"
    const outcome = await teardownServiceViaPool({ serviceId: "svc-1", workspaceId: "ws-1" })
    expect(outcome).toBe("deleted")
    expect(mockDeleteService).toHaveBeenCalledWith("svc-1")
  })

  it("recycle deferred -> recycling-deferred (service detached, sweeper owns it)", async () => {
    mockUpdateServiceVariables.mockRejectedValue(new Error("transient"))
    const outcome = await teardownServiceViaPool({ serviceId: "svc-1", workspaceId: "ws-1" })
    expect(outcome).toBe("recycling-deferred")
    expect(mockDeleteService).not.toHaveBeenCalled()
  })

  it("pool disabled + delete fails hard -> survived (caller keeps containerHost)", async () => {
    process.env.SERVICE_POOL_ENABLED = "false"
    mockDeleteService.mockRejectedValue(new Error("Railway API 503"))
    const outcome = await teardownServiceViaPool({ serviceId: "svc-1", workspaceId: "ws-1" })
    expect(outcome).toBe("survived")
  })
})

// ---------------------------------------------------------------------------
// refill math
// ---------------------------------------------------------------------------

describe("refillPlan", () => {
  const base = {
    readyCount: 0,
    target: 60,
    rollingCount: 0,
    usable: 23,
    headroom: 3,
    quotaHoldUntil: null,
    now: new Date("2026-09-17T06:00:00Z"),
    projectServiceCount: 10,
    projectCeiling: 100,
    batch: 5,
  }

  it("banks up to the batch size when budget and ceiling allow", () => {
    expect(refillPlan(base)).toBe(5)
  })

  it("MUTATION: refill respects governor headroom - rolling at usable-headroom banks zero", () => {
    // usable 23, headroom 3 -> refill may spend only while rolling < 20.
    expect(refillPlan({ ...base, rollingCount: 20 })).toBe(0)
    expect(refillPlan({ ...base, rollingCount: 19 })).toBe(1)
  })

  it("quota hold active -> zero", () => {
    expect(
      refillPlan({
        ...base,
        quotaHoldUntil: new Date("2026-09-17T07:00:00Z"),
      }),
    ).toBe(0)
  })

  it("project service ceiling (Phase A: 100 on Pro) is never crossed", () => {
    expect(refillPlan({ ...base, projectServiceCount: 100 })).toBe(0)
    expect(refillPlan({ ...base, projectServiceCount: 98 })).toBe(2)
  })

  it("pool at target -> zero", () => {
    expect(refillPlan({ ...base, readyCount: 60 })).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// refill tick
// ---------------------------------------------------------------------------

function stubBudget(args: { rolling: number; holdUntil?: Date | null }) {
  ;(prismaMock.railwayCreateLedger.count as MockFn).mockResolvedValue(args.rolling)
  ;(prismaMock.railwayCreateLedger.findMany as MockFn).mockResolvedValue([])
  ;(prismaMock.railwayGovernorState.findUnique as MockFn).mockResolvedValue(
    args.holdUntil !== undefined ? { quotaHoldUntil: args.holdUntil } : null,
  )
  ;(prismaMock.railwayGovernorState.upsert as MockFn).mockResolvedValue({ id: "default" })
  ;(prismaMock.railwayCreateLedger.create as MockFn).mockResolvedValue({})
  ;(prismaMock.provisioningQueue.deleteMany as MockFn).mockResolvedValue({ count: 0 })
}

describe("refillServicePoolTick", () => {
  it("banks empty services and ledgers each create under the pool sentinel", async () => {
    stubBudget({ rolling: 0 })
    mockCountProjectServices.mockResolvedValue(10)
    mockCreateEmptyPooledService
      .mockResolvedValueOnce({ serviceId: "svc-n1", domain: "n1.up.railway.app" })
      .mockResolvedValueOnce({ serviceId: "svc-n2", domain: "n2.up.railway.app" })
    process.env.SERVICE_POOL_REFILL_BATCH = "2"

    const result = await refillServicePoolTick(new Date("2026-09-17T06:00:00Z"))

    expect(result.created).toBe(2)
    expect(prismaMock.railwayCreateLedger.create).toHaveBeenCalledWith({
      data: { workspaceId: POOL_LEDGER_WORKSPACE_ID, serviceId: "svc-n1" },
    })
    expect(prismaMock.servicePool.create).toHaveBeenCalledWith({
      data: { serviceId: "svc-n1", domain: "n1.up.railway.app", state: "READY" },
    })
    delete process.env.SERVICE_POOL_REFILL_BATCH
  })

  it("Railway quota rejection mid-refill -> records governor hold and stops the batch", async () => {
    stubBudget({ rolling: 0 })
    mockCountProjectServices.mockResolvedValue(10)
    mockCreateEmptyPooledService.mockRejectedValue(
      new Error(
        "Railway GraphQL error: You've hit the service creation limit for new accounts (25 services per day). Contact us at station.railway.com to raise this.",
      ),
    )

    const result = await refillServicePoolTick(new Date("2026-09-17T06:00:00Z"))

    expect(result.created).toBe(0)
    expect(result.quotaHold).toBe(true)
    expect(prismaMock.railwayGovernorState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ quotaHoldUntil: expect.any(Date) }),
      }),
    )
  })

  it("cannot verify the project ceiling -> banks nothing this tick", async () => {
    stubBudget({ rolling: 0 })
    mockCountProjectServices.mockRejectedValue(new Error("Railway API 500"))

    const result = await refillServicePoolTick(new Date("2026-09-17T06:00:00Z"))

    expect(result.created).toBe(0)
    expect(mockCreateEmptyPooledService).not.toHaveBeenCalled()
  })

  it("low-watermark alert is MUTED during the expected-empty ramp (highWatermark below floor)", async () => {
    stubBudget({ rolling: 22 }) // no budget for creates
    mockCountProjectServices.mockResolvedValue(10)
    ;(prismaMock.servicePool.count as MockFn).mockResolvedValue(2) // ready=2 < 20
    ;(prismaMock.servicePoolMeta.upsert as MockFn).mockResolvedValue({
      id: "default",
      highWatermark: 5, // pool never reached the floor yet
      lowAlertSentAt: null,
      updatedAt: new Date(),
    })

    const result = await refillServicePoolTick(new Date("2026-09-17T06:00:00Z"))

    expect(result.lowAlerted).toBe(false)
    expect(mockSendOwnerAlert).not.toHaveBeenCalled()
  })

  it("owner alert fires when the pool dips below the floor after the ramp, with 12h dedup", async () => {
    stubBudget({ rolling: 22 })
    mockCountProjectServices.mockResolvedValue(10)
    ;(prismaMock.servicePool.count as MockFn).mockResolvedValue(12) // ready=12 < 20
    ;(prismaMock.servicePoolMeta.upsert as MockFn).mockResolvedValue({
      id: "default",
      highWatermark: 40, // ramp complete
      lowAlertSentAt: null,
      updatedAt: new Date(),
    })

    const result = await refillServicePoolTick(new Date("2026-09-17T06:00:00Z"))

    expect(result.lowAlerted).toBe(true)
    expect(mockSendOwnerAlert).toHaveBeenCalledWith(
      expect.objectContaining({ alertKey: "service-pool-low" }),
    )

    // Within the 12h window: muted.
    mockSendOwnerAlert.mockClear()
    ;(prismaMock.servicePoolMeta.upsert as MockFn).mockResolvedValue({
      id: "default",
      highWatermark: 40,
      lowAlertSentAt: new Date("2026-09-17T05:00:00Z"),
      updatedAt: new Date(),
    })
    const second = await refillServicePoolTick(new Date("2026-09-17T06:00:00Z"))
    expect(second.lowAlerted).toBe(false)
    expect(mockSendOwnerAlert).not.toHaveBeenCalled()
  })

  it("disabled or unconfigured -> full no-op", async () => {
    process.env.SERVICE_POOL_ENABLED = "false"
    const result = await refillServicePoolTick()
    expect(result.enabled).toBe(false)
    expect(mockCreateEmptyPooledService).not.toHaveBeenCalled()
  })

  it("retries RECYCLING rows old enough to not be in-flight", async () => {
    stubBudget({ rolling: 22 })
    mockCountProjectServices.mockResolvedValue(10)
    ;(prismaMock.servicePool.findMany as MockFn)
      .mockResolvedValueOnce([
        poolRow({ id: "pe-r", serviceId: "svc-r", state: "RECYCLING", workspaceId: "ws-old" }),
      ]) // sweepRecycling query
      .mockResolvedValueOnce([]) // stranded ASSIGNED query
    ;(prismaMock.servicePool.upsert as MockFn).mockResolvedValue(
      poolRow({ id: "pe-r", serviceId: "svc-r", state: "RECYCLING" }),
    )

    const result = await refillServicePoolTick(new Date("2026-09-17T06:00:00Z"))

    expect(result.sweptRecycling).toBe(1)
    expect(mockRemoveLatestDeployment).toHaveBeenCalledWith("svc-r")
    expect(mockUpdateServiceVariables).toHaveBeenCalledWith("svc-r", POOL_WIPE_MARKER)
  })
})
