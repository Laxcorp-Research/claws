// PR-2: tests for syncThenDestroy — the confirmed-sync teardown wrapper.
//
// Invariants under test:
//   - SYNCS BEFORE DESTROY: POSTs /internal/sync-now (with the metering secret)
//     before the container is deleted.
//   - 200 + persisted:true OR empty:true  → clears the incomplete marker, destroys.
//   - 502 / 503 / 401 / timeout / unreachable → records an incomplete marker
//     (with a reason) and DESTROYS ANYWAY (never-trap invariant).
//   - containerHost / containerId null → destroys WITHOUT a network call.
//   - SYNC_BEFORE_DESTROY=false → straight passthrough to destroyContainer.
//
// We let the REAL destroyContainer run (prisma + railway-client mocked, same as
// destroy-container.test.ts) so the marker write + the actual teardown are
// exercised end-to-end. Only `fetch` is stubbed.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

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

import { syncThenDestroy } from "@/lib/openclaw/deployer"

const SYNC_URL = "https://claw-ws-1.up.railway.app/internal/sync-now"
const SECRET = "test-metering-secret"

const mockFetch = vi.fn()

// destroyContainer wraps its two writes in prisma.$transaction([...]); invoke
// the inner ops so the workspace.update / containerState.updateMany spies
// register (mirrors destroy-container.test.ts).
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

// Minimal Response stand-in (the helper reads only .status and .json()).
function fetchOk(status: number, body: unknown) {
  mockFetch.mockResolvedValue({
    status,
    json: async () => body,
  } as unknown as Response)
}

function fetchThrows(err: Error) {
  mockFetch.mockRejectedValue(err)
}

let prevSecret: string | undefined
let prevFlag: string | undefined

beforeEach(() => {
  mockDeleteService.mockReset()
  mockDeleteService.mockResolvedValue(undefined)
  mockIsRailwayConfigured.mockReset()
  mockIsRailwayConfigured.mockReturnValue(true)
  mockFetch.mockReset()
  ;(prismaMock.containerState.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 })
  ;(prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({})
  stubTransactionToInvokeOps()
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

// Asserts the real destroyContainer ran (Workspace converged to STOPPED).
function expectDestroyed() {
  expect(prismaMock.workspace.update).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { id: "ws-1" },
      data: expect.objectContaining({ status: "STOPPED", containerId: null }),
    }),
  )
}

describe("syncThenDestroy — syncs before destroy", () => {
  it("POSTs /internal/sync-now with X-Metering-Secret before deleting the container", async () => {
    mockWorkspace()
    fetchOk(200, { ok: true, persisted: true, count: 3, fileCount: 5 })

    await syncThenDestroy("ws-1")

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0]
    expect(url).toBe(SYNC_URL)
    expect(init.method).toBe("POST")
    expect(init.headers["X-Metering-Secret"]).toBe(SECRET)
    // and it still tore the container down
    expect(mockDeleteService).toHaveBeenCalledWith("svc-abc")
    expectDestroyed()
  })

  it("clears the incomplete marker on a confirmed persist (200 persisted:true)", async () => {
    mockWorkspace()
    fetchOk(200, { ok: true, persisted: true, count: 1, fileCount: 2 })

    await syncThenDestroy("ws-1")

    expect(prismaMock.containerState.updateMany).toHaveBeenCalledWith({
      where: { workspaceId: "ws-1" },
      data: { lastSyncIncompleteAt: null, lastSyncIncompleteReason: null },
    })
    expectDestroyed()
  })

  it("treats an empty data dir (200 empty:true) as synced and destroys", async () => {
    mockWorkspace()
    fetchOk(200, { ok: true, persisted: false, empty: true })

    await syncThenDestroy("ws-1")

    expect(prismaMock.containerState.updateMany).toHaveBeenCalledWith({
      where: { workspaceId: "ws-1" },
      data: { lastSyncIncompleteAt: null, lastSyncIncompleteReason: null },
    })
    expectDestroyed()
  })
})

describe("syncThenDestroy — never-trap invariant (always destroys, records marker)", () => {
  it("records reason 'rejected' on a 502 and destroys anyway", async () => {
    mockWorkspace()
    fetchOk(502, { ok: false, status: "rejected" })

    const result = await syncThenDestroy("ws-1")
    expect(result).toEqual(expect.objectContaining({ destroyed: true }))

    expect(prismaMock.containerState.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: "ws-1" },
        data: expect.objectContaining({ lastSyncIncompleteReason: "rejected" }),
      }),
    )
    expectDestroyed()
  })

  it("records reason 'error' on a 503 and destroys anyway", async () => {
    mockWorkspace()
    fetchOk(503, { ok: false, status: "error" })

    await syncThenDestroy("ws-1")

    expect(prismaMock.containerState.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastSyncIncompleteReason: "error" }),
      }),
    )
    expectDestroyed()
  })

  it("records reason 'http-401' on a 401 (bad/missing secret) and destroys anyway", async () => {
    mockWorkspace()
    fetchOk(401, { ok: false, error: "unauthorized" })

    await syncThenDestroy("ws-1")

    expect(prismaMock.containerState.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastSyncIncompleteReason: "http-401" }),
      }),
    )
    expectDestroyed()
  })

  it("records reason 'timeout' when the sync call aborts and destroys anyway", async () => {
    mockWorkspace()
    const abort = new Error("The operation was aborted")
    abort.name = "AbortError"
    fetchThrows(abort)

    await syncThenDestroy("ws-1")

    expect(prismaMock.containerState.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastSyncIncompleteReason: "timeout" }),
      }),
    )
    expectDestroyed()
  })

  it("records reason 'unreachable' on a network error (crashed container) and destroys anyway", async () => {
    mockWorkspace()
    fetchThrows(new TypeError("fetch failed"))

    await syncThenDestroy("ws-1")

    expect(prismaMock.containerState.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastSyncIncompleteReason: "unreachable" }),
      }),
    )
    expectDestroyed()
  })

  it("stamps lastSyncIncompleteAt with a Date on failure", async () => {
    mockWorkspace()
    fetchOk(503, { ok: false, status: "accepted-unconfirmed" })

    await syncThenDestroy("ws-1")

    const markerCall = (prismaMock.containerState.updateMany as ReturnType<typeof vi.fn>).mock.calls.find(
      ([arg]) => arg?.data && "lastSyncIncompleteReason" in arg.data,
    )
    expect(markerCall).toBeTruthy()
    expect(markerCall![0].data.lastSyncIncompleteAt).toBeInstanceOf(Date)
  })
})

describe("syncThenDestroy — no reachable container", () => {
  it("destroys WITHOUT a network call when containerHost is null", async () => {
    mockWorkspace({ containerHost: null })

    await syncThenDestroy("ws-1")

    expect(mockFetch).not.toHaveBeenCalled()
    expectDestroyed()
  })

  it("destroys WITHOUT a network call when containerId is null (already torn down)", async () => {
    mockWorkspace({ containerId: null })

    await syncThenDestroy("ws-1")

    expect(mockFetch).not.toHaveBeenCalled()
    expectDestroyed()
  })
})

describe("syncThenDestroy — SYNC_BEFORE_DESTROY kill-switch", () => {
  it("flag=false → straight passthrough to destroyContainer (no sync, no marker)", async () => {
    process.env.SYNC_BEFORE_DESTROY = "false"
    mockWorkspace()

    await syncThenDestroy("ws-1")

    expect(mockFetch).not.toHaveBeenCalled()
    // no marker write at all on the bare path
    const markerWrites = (prismaMock.containerState.updateMany as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([arg]) => arg?.data && "lastSyncIncompleteReason" in arg.data,
    )
    expect(markerWrites).toHaveLength(0)
    expectDestroyed()
  })
})

describe("syncThenDestroy — Lifecycle P3 refuse-unsafe (auto-hibernate)", () => {
  it("sync-fail → container kept (not destroyed) + refused reason", async () => {
    mockWorkspace()
    fetchOk(503, { ok: false, status: "error" })

    const result = await syncThenDestroy("ws-1", { destroyPolicy: "refuse-unsafe" })

    expect(result).toEqual({
      destroyed: false,
      refused: true,
      reason: "sync-failed:error",
    })
    expect(mockDeleteService).not.toHaveBeenCalled()
    expect(prismaMock.workspace.update).not.toHaveBeenCalled()
  })

  it("MUTATION: destroy-anyway restored on hibernate path would fail this (default still destroys)", async () => {
    mockWorkspace()
    fetchOk(503, { ok: false, status: "error" })
    const destroyAnyway = await syncThenDestroy("ws-1") // default
    expect(destroyAnyway.destroyed).toBe(true)
    expectDestroyed()
  })

  it("stale-beyond-threshold refused even when sync confirms", async () => {
    const staleAt = new Date(Date.now() - 60 * 60 * 1000) // 60m > default 30m
    mockWorkspace({ runtimeStateUpdatedAt: staleAt })
    fetchOk(200, { ok: true, persisted: true, count: 1, fileCount: 1 })

    const result = await syncThenDestroy("ws-1", { destroyPolicy: "refuse-unsafe" })

    expect(result).toEqual({
      destroyed: false,
      refused: true,
      reason: "stale-snapshot",
    })
    expect(mockDeleteService).not.toHaveBeenCalled()
  })

  it("FORCE path destroys despite sync-fail", async () => {
    mockWorkspace()
    fetchOk(503, { ok: false, status: "error" })

    const result = await syncThenDestroy("ws-1", { destroyPolicy: "force" })

    expect(result.destroyed).toBe(true)
    expectDestroyed()
  })

  it("healthy path (sync ok + fresh snapshot) destroys under refuse-unsafe", async () => {
    mockWorkspace({ runtimeStateUpdatedAt: new Date() })
    fetchOk(200, { ok: true, persisted: true, count: 1, fileCount: 1 })

    const result = await syncThenDestroy("ws-1", { destroyPolicy: "refuse-unsafe" })

    expect(result).toEqual({ destroyed: true })
    expectDestroyed()
  })

  it("user-Stop (destroy-anyway) proceeds with syncWarning on sync-fail", async () => {
    mockWorkspace()
    fetchOk(503, { ok: false, status: "error" })

    const result = await syncThenDestroy("ws-1", { destroyPolicy: "destroy-anyway" })

    expect(result.destroyed).toBe(true)
    if (result.destroyed) {
      expect(result.syncWarning).toMatch(/sync failed/i)
    }
    expectDestroyed()
  })
})
