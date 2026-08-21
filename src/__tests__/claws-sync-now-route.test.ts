// PR-1: tests for the /internal/sync-now route handler on the claws-activity-
// reporter overlay plugin. Verifies the backend's confirmation contract:
//   - auth: missing/wrong CLAWS_METERING_SECRET → 401, sync NOT triggered.
//   - 200 ONLY on a confirmed persist (count>=1) or an empty data dir.
//   - non-persist outcomes → non-2xx (so syncThenDestroy knows it's unconfirmed).
//   - the route is registered with auth:"plugin", exact match, on /internal/sync-now.
//
// runStateSync is mocked so we test the route's auth + status→HTTP mapping in
// isolation (the sync logic itself is covered by state-sync.test.ts).

import { describe, it, expect, beforeEach, vi } from "vitest"

const mockRunStateSync = vi.hoisted(() => vi.fn())
vi.mock("../../container/state-sync.mjs", () => ({
  runStateSync: mockRunStateSync,
  // other named exports unused by the plugin, present for completeness
  bundleRuntimeState: vi.fn(),
  isRuntimeFile: vi.fn(),
  OPENCLAW_DATA_DIR: "/home/node/.openclaw",
  __isSyncInFlight: vi.fn(),
}))

const SECRET = "test-metering-secret"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockRes(): any {
  return {
    statusCode: 0,
    _headers: {} as Record<string, string>,
    _body: "",
    setHeader(k: string, v: string) {
      this._headers[k.toLowerCase()] = v
    },
    end(b?: string) {
      this._body = b ?? ""
    },
    json() {
      return JSON.parse(this._body || "{}")
    },
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mockReq(method: string, secret?: string): any {
  const headers: Record<string, string> = {}
  if (secret !== undefined) headers["x-metering-secret"] = secret
  return { method, headers }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let handleSyncNow: (req: any, res: any) => Promise<boolean>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pluginEntry: any

beforeEach(async () => {
  mockRunStateSync.mockReset()
  process.env.CLAWS_METERING_SECRET = SECRET
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = (await import("../../container/claws-activity-reporter/index.mjs")) as any
  handleSyncNow = m.__test__.handleSyncNow
  pluginEntry = m.default
})

describe("/internal/sync-now - auth", () => {
  it("rejects a missing secret with 401 and does NOT trigger a sync", async () => {
    const res = mockRes()
    await handleSyncNow(mockReq("POST"), res)
    expect(res.statusCode).toBe(401)
    expect(mockRunStateSync).not.toHaveBeenCalled()
  })

  it("rejects a wrong secret with 401 and does NOT trigger a sync (mutation guard)", async () => {
    const res = mockRes()
    await handleSyncNow(mockReq("POST", "wrong"), res)
    expect(res.statusCode).toBe(401)
    expect(mockRunStateSync).not.toHaveBeenCalled()
  })

  it("rejects non-POST with 405", async () => {
    const res = mockRes()
    await handleSyncNow(mockReq("GET", SECRET), res)
    expect(res.statusCode).toBe(405)
    expect(mockRunStateSync).not.toHaveBeenCalled()
  })
})

describe("/internal/sync-now - status → HTTP mapping (200 only on confirmed persist)", () => {
  it("200 + persisted:true when the sync confirms count>=1", async () => {
    mockRunStateSync.mockResolvedValue({ status: "persisted", count: 3, fileCount: 5 })
    const res = mockRes()
    await handleSyncNow(mockReq("POST", SECRET), res)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ ok: true, persisted: true, count: 3 })
  })

  it("200 + empty:true when there is nothing to sync (empty data dir)", async () => {
    mockRunStateSync.mockResolvedValue({ status: "empty", fileCount: 0 })
    const res = mockRes()
    await handleSyncNow(mockReq("POST", SECRET), res)
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ ok: true, persisted: false, empty: true })
  })

  it("502 when the server rejected the upload (NOT persisted)", async () => {
    mockRunStateSync.mockResolvedValue({ status: "rejected", httpStatus: 413 })
    const res = mockRes()
    await handleSyncNow(mockReq("POST", SECRET), res)
    expect(res.statusCode).toBe(502)
    expect(res.json()).toMatchObject({ ok: false, status: "rejected" })
  })

  it("503 on error / accepted-unconfirmed / unconfigured (not guaranteed)", async () => {
    for (const status of ["error", "accepted-unconfirmed", "unconfigured"]) {
      mockRunStateSync.mockResolvedValue({ status })
      const res = mockRes()
      await handleSyncNow(mockReq("POST", SECRET), res)
      expect(res.statusCode).toBe(503)
    }
  })

  it("500 if the sync call itself throws", async () => {
    mockRunStateSync.mockRejectedValue(new Error("boom"))
    const res = mockRes()
    await handleSyncNow(mockReq("POST", SECRET), res)
    expect(res.statusCode).toBe(500)
  })
})

describe("/internal/sync-now - route registration", () => {
  it("registers an exact, auth:plugin route at /internal/sync-now", () => {
    const registerHttpRoute = vi.fn()
    pluginEntry.register({ on: vi.fn(), registerHttpRoute })
    expect(registerHttpRoute).toHaveBeenCalledTimes(1)
    const arg = registerHttpRoute.mock.calls[0][0]
    expect(arg.path).toBe("/internal/sync-now")
    expect(arg.auth).toBe("plugin")
    expect(arg.match).toBe("exact")
    expect(typeof arg.handler).toBe("function")
  })
})
