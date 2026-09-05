// PR-9/A-vercel: POST /api/workspaces/[id]/chat route tests (client mocked).
//
// Covers auth, ownership, body validation, the full V2 status-gate matrix +
// amendment-1 error codes, amendment-2 missing-containerHost→502, rate-limit
// 429, lazy keygen persists-exactly-once, the V3 no-ActivityLog-write
// assertion, V6 same-key single retry, and the 202 shape.
//
// Mutation-verified (V8): M1 HIBERNATED proceeds → status-matrix test fails;
// M2 route writes ActivityLog → no-write assertion fails; M3 fresh-key retry
// → V6 same-key test fails.

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { createMockRequest, parseResponse } from "@/test/helpers/mock-request"

beforeAll(() => {
  process.env.ENCRYPTION_MASTER_KEY = "00".repeat(32)
  process.env.ENCRYPTION_KEY_VERSION = "v1"
})

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))
vi.mock("@/lib/api/auth", () => ({
  getSessionUser: vi.fn().mockResolvedValue({ id: "user-1", email: "u@test.com" }),
}))
vi.mock("@/lib/api/ownership", () => ({
  verifyWorkspaceOwnership: vi.fn().mockResolvedValue({ error: null, workspace: { id: "ws-1", userId: "user-1" } }),
}))
vi.mock("@/lib/openclaw/deployer", () => ({
  getGatewayConnectionInfo: vi.fn().mockResolvedValue({ wsUrl: "wss://claw-test.up.railway.app", token: "gw-token" }),
}))
vi.mock("@/lib/hibernation/manager", () => ({
  wakeWorkspace: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/trial/wake-entitlement", () => ({
  canWakeHibernatedWorkspace: vi.fn().mockReturnValue({ allowed: true }),
}))
const mockLimit = vi.fn().mockResolvedValue({ success: true })
vi.mock("@/lib/rate-limit", () => ({ chatRateLimit: { limit: (...a: unknown[]) => mockLimit(...a) } }))

import { POST, __setChatRouteDepsForTests } from "@/app/api/workspaces/[id]/chat/route"
import { encryptDeviceIdentity, generateDeviceIdentity } from "@/lib/openclaw/device-identity"

const params = (id = "ws-1") => ({ params: Promise.resolve({ id }) })
const post = (body: unknown, id = "ws-1") =>
  POST(createMockRequest(`http://localhost/api/workspaces/${id}/chat`, { method: "POST", body }), params(id))

const mockSend = vi.fn()
const afterQueue: Array<() => unknown> = []
function mockAfter(fn: () => unknown) {
  afterQueue.push(fn)
}
async function flushAfter() {
  const fns = afterQueue.splice(0)
  for (const fn of fns) await fn()
}

function workspaceRow(overrides: Record<string, unknown> = {}) {
  return {
    status: "RUNNING",
    containerHost: "claw-test.up.railway.app",
    gatewayToken: "enc-gw-token",
    chatDeviceKeyEncrypted: null,
    ...overrides,
  }
}

beforeEach(async () => {
  mockSend.mockReset()
  afterQueue.length = 0
  mockSend.mockResolvedValue({ ok: true, runId: "idem-xyz", status: "started", paired: false })
  __setChatRouteDepsForTests({ send: mockSend, after: mockAfter })
  mockLimit.mockResolvedValue({ success: true })

  const { getSessionUser } = await import("@/lib/api/auth")
  ;(getSessionUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "user-1", email: "u@test.com" })
  const { verifyWorkspaceOwnership } = await import("@/lib/api/ownership")
  ;(verifyWorkspaceOwnership as ReturnType<typeof vi.fn>).mockResolvedValue({ error: null, workspace: { id: "ws-1", userId: "user-1" } })
  const { getGatewayConnectionInfo } = await import("@/lib/openclaw/deployer")
  ;(getGatewayConnectionInfo as ReturnType<typeof vi.fn>).mockResolvedValue({ wsUrl: "wss://claw-test.up.railway.app", token: "gw-token" })
  ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(workspaceRow())
  ;(prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({})
  ;(prismaMock.agent.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ agentSlug: "dev-commander" })
})

describe("POST /api/workspaces/[id]/chat", () => {
  it("401 when unauthenticated", async () => {
    const { getSessionUser } = await import("@/lib/api/auth")
    ;(getSessionUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)
    expect((await post({ message: "hi" })).status).toBe(401)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it("404 / 403 from ownership", async () => {
    const { verifyWorkspaceOwnership } = await import("@/lib/api/ownership")
    ;(verifyWorkspaceOwnership as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ error: "NOT_FOUND", workspace: null })
    expect((await post({ message: "hi" })).status).toBe(404)
    ;(verifyWorkspaceOwnership as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ error: "FORBIDDEN", workspace: null })
    expect((await post({ message: "hi" })).status).toBe(403)
  })

  it("400 on empty / missing / oversized message", async () => {
    expect((await post({ message: "" })).status).toBe(400)
    expect((await post({})).status).toBe(400)
    expect((await post({ message: "x".repeat(4001) })).status).toBe(400)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it("429 when the per-workspace rate limit is exceeded", async () => {
    mockLimit.mockResolvedValueOnce({ success: false })
    const res = await post({ message: "hi" })
    expect(res.status).toBe(429)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it("rate limiter is keyed per user:workspace", async () => {
    await post({ message: "hi" })
    expect(mockLimit).toHaveBeenCalledWith("user-1:ws-1")
  })

  // ─── V2 status-gate matrix (amendment-1 codes) ───────────────────────────
  it.each([
    ["STOPPED", 409, "WORKSPACE_STOPPED"],
    ["DRAFT", 409, "WORKSPACE_TRANSITIONING"],
  ])("status %s → %i %s, gateway never contacted", async (status, code, errCode) => {
    ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(workspaceRow({ status }))
    const res = await post({ message: "hi" })
    const { status: httpStatus, data } = await parseResponse(res)
    expect(httpStatus).toBe(code)
    expect(data.error.code).toBe(errCode)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it.each(["HIBERNATED", "DEPLOYING", "WAKING", "PROVISIONING_QUEUED"])("status %s holds the send (202, no gateway)", async (status) => {
    ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(workspaceRow({ status }))
    ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { trialUsed: true, trialStartedAt: new Date(), trialEndsAt: new Date(Date.now() + 86400000), hasActiveSubscription: true },
    })
    const { status: httpStatus, data } = await parseResponse(await post({ message: "hi" }))
    expect(httpStatus).toBe(202)
    expect(data.data.held).toBe(true)
    expect(data.data.holdReason).toBe(status)
    expect(mockSend).not.toHaveBeenCalled()
    expect(prismaMock.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "Chat send held",
          actionType: "SYSTEM",
        }),
      }),
    )
  })

  it("HIBERNATED with expired trial → 402, no hold ledger", async () => {
    const { canWakeHibernatedWorkspace } = await import("@/lib/trial/wake-entitlement")
    ;(canWakeHibernatedWorkspace as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      allowed: false,
      reason: "trial_ended",
      needsSubscription: true,
    })
    ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
      workspaceRow({ status: "HIBERNATED" }),
    )
    ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      user: { trialUsed: true, trialStartedAt: new Date(), trialEndsAt: new Date(0), hasActiveSubscription: false },
    })
    const { status, data } = await parseResponse(await post({ message: "hi" }))
    expect(status).toBe(402)
    expect(data.error.code).toBe("SUBSCRIPTION_REQUIRED")
    expect(prismaMock.activityLog.create).not.toHaveBeenCalled()
    expect(mockSend).not.toHaveBeenCalled()
  })

  it("RUNNING → 202 before gateway send (after() delivers)", async () => {
    const res = await post({ message: "hi" })
    expect(res.status).toBe(202)
    expect(mockSend).not.toHaveBeenCalled()
    await flushAfter()
    expect(mockSend).toHaveBeenCalledTimes(1)
  })

  it("ERROR → schedules the send (recovery path)", async () => {
    ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(workspaceRow({ status: "ERROR" }))
    await post({ message: "hi" })
    expect(mockSend).not.toHaveBeenCalled()
    await flushAfter()
    expect(mockSend).toHaveBeenCalledTimes(1)
  })

  it("MUTATION: sync-wait restored → fail (202 must not await chat.send)", async () => {
    let resolveSend: ((value: { ok: true; runId: string; status: string; paired: boolean }) => void) | undefined
    mockSend.mockReturnValue(
      new Promise((resolve) => {
        resolveSend = resolve
      }),
    )
    const started = Date.now()
    const res = await post({ message: "hi" })
    const elapsedMs = Date.now() - started
    expect(res.status).toBe(202)
    expect(elapsedMs).toBeLessThan(500)
    expect(mockSend).not.toHaveBeenCalled()
    const afterRun = flushAfter()
    resolveSend?.({ ok: true, runId: "late", status: "started", paired: false })
    await afterRun
  })

  it("amendment-2: RUNNING but missing containerHost/gatewayToken → 502 GATEWAY_UNREACHABLE, no send", async () => {
    ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(workspaceRow({ containerHost: null }))
    const { status, data } = await parseResponse(await post({ message: "hi" }))
    expect(status).toBe(502)
    expect(data.error.code).toBe("GATEWAY_UNREACHABLE")
    expect(mockSend).not.toHaveBeenCalled()
  })

  // ─── Error-code mapping (amendment 1) ────────────────────────────────────
  it("send unreachable after 202 ledgers reject (HTTP stays 202)", async () => {
    mockSend.mockResolvedValue({ ok: false, reason: "unreachable", detail: "x" })
    const { status, data } = await parseResponse(await post({ message: "hi" }))
    expect(status).toBe(202)
    expect(typeof data.data.runId).toBe("string")
    await flushAfter()
    expect(prismaMock.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "Chat send rejected mid-boot",
          actionType: "ERROR",
        }),
      }),
    )
  })

  it("send transitioning after 202 ledgers reject (HTTP stays 202)", async () => {
    mockSend.mockResolvedValue({ ok: false, reason: "transitioning", detail: "starting" })
    const { status } = await parseResponse(await post({ message: "hi" }))
    expect(status).toBe(202)
    await flushAfter()
    expect(prismaMock.activityLog.create).toHaveBeenCalled()
  })

  // ─── V4 lazy keygen: persists exactly once, reused thereafter ────────────
  it("first send (no device key) generates + persists exactly once", async () => {
    await post({ message: "hi" })
    await flushAfter()
    expect(prismaMock.workspace.update).toHaveBeenCalledTimes(1)
    const call = (prismaMock.workspace.update as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.data.chatDeviceKeyEncrypted).toEqual(expect.any(String))
  })

  it("subsequent send (device key present) reuses it - no persist", async () => {
    const blob = encryptDeviceIdentity(generateDeviceIdentity())
    ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(workspaceRow({ chatDeviceKeyEncrypted: blob }))
    await post({ message: "hi" })
    await flushAfter()
    expect(prismaMock.workspace.update).not.toHaveBeenCalled()
    expect(mockSend).toHaveBeenCalledTimes(1)
  })

  // ─── V3: route writes NO ActivityLog row ─────────────────────────────────
  it("writes NO ActivityLog row (container hook owns the canonical row)", async () => {
    await post({ message: "hi" })
    await flushAfter()
    expect(prismaMock.activityLog.create).not.toHaveBeenCalled()
  })

  it("DEPLOYING ledgers a held send so the message does not vanish", async () => {
    ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(
      workspaceRow({ status: "DEPLOYING" }),
    )
    const res = await post({ message: "hi" })
    expect(res.status).toBe(202)
    expect(prismaMock.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "Chat send held",
          actionType: "SYSTEM",
        }),
      }),
    )
    expect(mockSend).not.toHaveBeenCalled()
  })

  it("unreachable after retry ledgers the rejected send", async () => {
    mockSend.mockResolvedValue({ ok: false, reason: "unreachable", detail: "chat.send rejected: ?" })
    const res = await post({ message: "hi" })
    expect(res.status).toBe(202)
    await flushAfter()
    expect(prismaMock.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "Chat send rejected mid-boot",
          actionType: "ERROR",
        }),
      }),
    )
  })

  // ─── V6: at most one retry, SAME idempotencyKey ──────────────────────────
  it("retries once on unreachable with the SAME idempotencyKey, then succeeds", async () => {
    mockSend
      .mockResolvedValueOnce({ ok: false, reason: "unreachable", detail: "transient" })
      .mockResolvedValueOnce({ ok: true, runId: "idem-xyz", status: "started", paired: false })
    const res = await post({ message: "hi" })
    expect(res.status).toBe(202)
    expect(mockSend).not.toHaveBeenCalled()
    await flushAfter()
    expect(mockSend).toHaveBeenCalledTimes(2)
    const key1 = mockSend.mock.calls[0][0].idempotencyKey
    const key2 = mockSend.mock.calls[1][0].idempotencyKey
    expect(key1).toBe(key2) // V6: never a fresh key on retry
  })

  it("does not retry more than once (two unreachable → single after() failure)", async () => {
    mockSend.mockResolvedValue({ ok: false, reason: "unreachable", detail: "down" })
    const res = await post({ message: "hi" })
    expect(res.status).toBe(202)
    await flushAfter()
    expect(mockSend).toHaveBeenCalledTimes(2) // initial + exactly one retry
  })

  it("202 body shape is { runId } from the server key, not the gateway wait", async () => {
    const { status, data } = await parseResponse(await post({ message: "hi" }))
    expect(status).toBe(202)
    expect(data.success).toBe(true)
    expect(typeof data.data.runId).toBe("string")
    expect(data.data.runId.length).toBeGreaterThan(8)
    await flushAfter()
    expect(mockSend.mock.calls[0][0].idempotencyKey).toBe(data.data.runId)
  })

  it("MUTATION: route must schedule send via after(), not await it before 202", () => {
    const src = readFileSync(join(process.cwd(), "src/app/api/workspaces/[id]/chat/route.ts"), "utf8")
    expect(src).toContain("schedule(async () =>")
    expect(src).toContain("return apiSuccess({ runId: idempotencyKey }, 202)")
    expect(src).not.toMatch(/let result: SendChatResult = await attempt\(\)[\s\S]{0,400}return apiError/)
  })
})
