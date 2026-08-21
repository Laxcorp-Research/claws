// HWD: hibernate removes the Railway deployment, keeps the service.
// MUTATION: serviceDelete on hibernate, createService on wake-with-id, or
// sleepApplication: true → these tests fail.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

const mockDeleteService = vi.fn()
const mockRemoveLatestDeployment = vi.fn()
const mockIsRailwayConfigured = vi.fn()
const mockGetServiceStatus = vi.fn()

vi.mock("@/lib/openclaw/railway-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/openclaw/railway-client")>(
    "@/lib/openclaw/railway-client",
  )
  return {
    ...actual,
    deleteService: (...args: unknown[]) => mockDeleteService(...args),
    removeLatestDeployment: (...args: unknown[]) => mockRemoveLatestDeployment(...args),
    isRailwayConfigured: () => mockIsRailwayConfigured(),
    getServiceStatus: (...args: unknown[]) => mockGetServiceStatus(...args),
  }
})

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), deployEvent: vi.fn() },
}))

import {
  syncThenRemoveDeployment,
  waitForDeploymentSuccess,
} from "@/lib/openclaw/deployer"

const SECRET = "test-metering-secret"
const mockFetch = vi.fn()

function stubTransactionToInvokeOps() {
  ;(prismaMock.$transaction as ReturnType<typeof vi.fn>).mockImplementation(async (ops: unknown) => {
    if (Array.isArray(ops)) return Promise.all(ops as Promise<unknown>[])
    return undefined
  })
}

function mockWorkspace(
  overrides: {
    containerId?: string | null
    containerHost?: string | null
    runtimeStateUpdatedAt?: Date | null
  } = {},
) {
  const {
    containerId = "svc-abc",
    containerHost = "claw-ws-1.up.railway.app",
    runtimeStateUpdatedAt = new Date(),
  } = overrides
  ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "ws-1",
    containerId,
    containerHost,
    containerState: { runtimeStateUpdatedAt },
  })
  ;(prismaMock.containerState.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
    runtimeStateUpdatedAt,
  } as never)
}

function fetchOk(status: number, body: unknown) {
  mockFetch.mockResolvedValue({
    status,
    json: async () => body,
  } as unknown as Response)
}

let prevSecret: string | undefined
let prevFlag: string | undefined

beforeEach(() => {
  mockDeleteService.mockReset().mockResolvedValue(undefined)
  mockRemoveLatestDeployment.mockReset().mockResolvedValue("dep-live")
  mockIsRailwayConfigured.mockReset().mockReturnValue(true)
  mockGetServiceStatus.mockReset()
  mockFetch.mockReset()
  ;(prismaMock.containerState.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 })
  ;(prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({})
  stubTransactionToInvokeOps()
  vi.stubGlobal("fetch", mockFetch)
  prevSecret = process.env.METERING_MASTER_SECRET
  prevFlag = process.env.SYNC_BEFORE_DESTROY
  process.env.METERING_MASTER_SECRET = SECRET
  delete process.env.SYNC_BEFORE_DESTROY
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  if (prevSecret === undefined) delete process.env.METERING_MASTER_SECRET
  else process.env.METERING_MASTER_SECRET = prevSecret
  if (prevFlag === undefined) delete process.env.SYNC_BEFORE_DESTROY
  else process.env.SYNC_BEFORE_DESTROY = prevFlag
})

describe("HWD source contracts", () => {
  it("hibernate path uses syncThenRemoveDeployment and never serviceDelete", () => {
    const mgr = readFileSync(join(process.cwd(), "src/lib/hibernation/manager.ts"), "utf8")
    expect(mgr).toContain("syncThenRemoveDeployment")
    expect(mgr).not.toMatch(/await syncThenDestroy\(/)
    expect(mgr).not.toMatch(/\bdestroyContainer\(/)
    expect(mgr).not.toMatch(/\bdeleteService\(/)
    expect(mgr).not.toMatch(/containerId:\s*null/)
    expect(mgr).not.toMatch(/containerHost:\s*null/)
  })

  it("sleepApplication_bypasses_entitlement_gate - source never enables serverless", () => {
    const client = readFileSync(join(process.cwd(), "src/lib/openclaw/railway-client.ts"), "utf8")
    expect(client).toContain("sleepApplication_bypasses_entitlement_gate")
    expect(client).toContain("sleepApplication: false")
    expect(client).not.toMatch(/sleepApplication:\s*true/)
    expect(client).toContain("assertSleepApplicationNeverEnabled")
  })

  it("health-monitor stays RUNNING/ERROR-scoped (HIBERNATED-with-service is legal)", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/api/cron/health-monitor/route.ts"),
      "utf8",
    )
    expect(src).toContain('status: { in: ["RUNNING", "ERROR"] }')
    expect(src).toContain("HIBERNATED / STOPPED")
  })
})

describe("syncThenRemoveDeployment - keep service", () => {
  it("syncs then removeLatestDeployment; never deleteService; ids persist", async () => {
    mockWorkspace()
    fetchOk(200, { ok: true, persisted: true, count: 1, fileCount: 1 })

    const result = await syncThenRemoveDeployment("ws-1", { destroyPolicy: "refuse-unsafe" })

    expect(result).toEqual({ destroyed: true })
    expect(mockRemoveLatestDeployment).toHaveBeenCalledWith("svc-abc")
    expect(mockDeleteService).not.toHaveBeenCalled()
    expect(prismaMock.workspace.update).not.toHaveBeenCalled()
  })

  it("refuse-unsafe sync-fail does not remove deployment", async () => {
    mockWorkspace()
    fetchOk(503, { ok: false, status: "error" })

    const result = await syncThenRemoveDeployment("ws-1", { destroyPolicy: "refuse-unsafe" })

    expect(result).toEqual({
      destroyed: false,
      refused: true,
      reason: "sync-failed:error",
    })
    expect(mockRemoveLatestDeployment).not.toHaveBeenCalled()
    expect(mockDeleteService).not.toHaveBeenCalled()
  })
})

describe("waitForDeploymentSuccess - REMOVED latest is not success", () => {
  it("polls past REMOVED then returns the new SUCCESS id", async () => {
    vi.useFakeTimers()
    mockGetServiceStatus
      .mockResolvedValueOnce({
        status: "REMOVED",
        deploymentId: "dep-old",
        healthy: false,
        createdAt: null,
      })
      .mockResolvedValueOnce({
        status: "SUCCESS",
        deploymentId: "dep-new",
        healthy: true,
        createdAt: null,
      })

    const pending = waitForDeploymentSuccess("svc-abc", null, 30_000)
    await vi.advanceTimersByTimeAsync(3_000)
    await expect(pending).resolves.toBe("dep-new")
    expect(mockGetServiceStatus).toHaveBeenCalledTimes(2)
  })

  it("NO_DEPLOYMENT is hibernated-with-service - keep polling until SUCCESS", async () => {
    vi.useFakeTimers()
    mockGetServiceStatus
      .mockResolvedValueOnce({
        status: "NO_DEPLOYMENT",
        deploymentId: null,
        healthy: false,
        createdAt: null,
      })
      .mockResolvedValueOnce({
        status: "SUCCESS",
        deploymentId: "dep-wake",
        healthy: true,
        createdAt: null,
      })

    const pending = waitForDeploymentSuccess("svc-abc", null, 30_000)
    await vi.advanceTimersByTimeAsync(3_000)
    await expect(pending).resolves.toBe("dep-wake")
  })
})
