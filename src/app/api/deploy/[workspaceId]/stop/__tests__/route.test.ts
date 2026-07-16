// PR-2: Stop route contract. Stop now routes through syncThenDestroy (confirmed
// pre-destroy sync). This is an INTEGRATION test — the REAL syncThenDestroy /
// destroyContainer run (only db, railway-client, logger, auth, ownership, and
// fetch are mocked) — so the never-trap invariant is proven end-to-end:
// even when the sync call fails, the Stop still succeeds ({stopped:true}).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { createMockRequest } from "@/test/helpers/mock-request"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

const mockGetSessionUser = vi.fn()
vi.mock("@/lib/api/auth", () => ({ getSessionUser: () => mockGetSessionUser() }))

const mockVerifyOwnership = vi.fn()
vi.mock("@/lib/api/ownership", () => ({
  verifyWorkspaceOwnership: (...args: unknown[]) => mockVerifyOwnership(...args),
}))

const mockDeleteService = vi.fn()
const mockIsRailwayConfigured = vi.fn()
vi.mock("@/lib/openclaw/railway-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/openclaw/railway-client")>(
    "@/lib/openclaw/railway-client",
  )
  return {
    ...actual,
    deleteService: (...args: unknown[]) => mockDeleteService(...args),
    isRailwayConfigured: () => mockIsRailwayConfigured(),
  }
})

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { POST } from "@/app/api/deploy/[workspaceId]/stop/route"

const SECRET = "test-metering-secret"
const mockFetch = vi.fn()

async function callRoute(workspaceId = "ws-1") {
  const req = createMockRequest(`http://localhost:3000/api/deploy/${workspaceId}/stop`, {
    method: "POST",
  })
  return POST(req, { params: Promise.resolve({ workspaceId }) })
}

let prevSecret: string | undefined
let prevFlag: string | undefined

beforeEach(() => {
  mockGetSessionUser.mockReset()
  mockVerifyOwnership.mockReset()
  mockDeleteService.mockReset()
  mockDeleteService.mockResolvedValue(undefined)
  mockIsRailwayConfigured.mockReset()
  mockIsRailwayConfigured.mockReturnValue(true)
  mockFetch.mockReset()
  ;(prismaMock.containerState.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 })
  ;(prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({})
  ;(prismaMock.$transaction as ReturnType<typeof vi.fn>).mockImplementation(async (ops: unknown) => {
    if (Array.isArray(ops)) return Promise.all(ops as Promise<unknown>[])
    return undefined
  })
  ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "ws-1",
    containerId: "svc-abc",
    containerHost: "claw-ws-1.up.railway.app",
    containerState: { runtimeStateUpdatedAt: new Date() },
  })
  vi.stubGlobal("fetch", mockFetch)

  prevSecret = process.env.METERING_MASTER_SECRET
  prevFlag = process.env.SYNC_BEFORE_DESTROY
  process.env.METERING_MASTER_SECRET = SECRET
  delete process.env.SYNC_BEFORE_DESTROY // default ON
})

afterEach(() => {
  vi.unstubAllGlobals()
  if (prevSecret === undefined) delete process.env.METERING_MASTER_SECRET
  else process.env.METERING_MASTER_SECRET = prevSecret
  if (prevFlag === undefined) delete process.env.SYNC_BEFORE_DESTROY
  else process.env.SYNC_BEFORE_DESTROY = prevFlag
})

describe("POST /api/deploy/[workspaceId]/stop", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetSessionUser.mockResolvedValue(null)
    const res = await callRoute()
    expect(res.status).toBe(401)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it("routes Stop through syncThenDestroy (POSTs sync-now) and returns {stopped:true}", async () => {
    mockGetSessionUser.mockResolvedValue({ id: "user-1" })
    mockVerifyOwnership.mockResolvedValue({ error: null, workspace: { id: "ws-1" } })
    mockFetch.mockResolvedValue({
      status: 200,
      json: async () => ({ ok: true, persisted: true, count: 2, fileCount: 3 }),
    } as unknown as Response)

    const res = await callRoute()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.stopped).toBe(true)
    expect(json.data.status).toBe("STOPPED")
    // proves it went through syncThenDestroy, not bare destroyContainer
    expect(mockFetch).toHaveBeenCalledWith(
      "https://claw-ws-1.up.railway.app/internal/sync-now",
      expect.objectContaining({ method: "POST" }),
    )
    expect(mockDeleteService).toHaveBeenCalledWith("svc-abc")
  })

  it("never traps the user: returns {stopped:true} even when the pre-destroy sync fails", async () => {
    mockGetSessionUser.mockResolvedValue({ id: "user-1" })
    mockVerifyOwnership.mockResolvedValue({ error: null, workspace: { id: "ws-1" } })
    // container unreachable / crashed → fetch rejects
    mockFetch.mockRejectedValue(new TypeError("fetch failed"))

    const res = await callRoute()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.stopped).toBe(true)
    expect(json.data.status).toBe("STOPPED")
    // the failure was recorded...
    expect(prismaMock.containerState.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastSyncIncompleteReason: "unreachable" }),
      }),
    )
    // ...and the container was still destroyed
    expect(mockDeleteService).toHaveBeenCalledWith("svc-abc")
  })
})
