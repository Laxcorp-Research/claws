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
const mockLimit = vi.fn().mockResolvedValue({ success: true })
vi.mock("@/lib/rate-limit", () => ({ chatRateLimit: { limit: (...a: unknown[]) => mockLimit(...a) } }))

import { POST, __setChatRouteDepsForTests } from "@/app/api/workspaces/[id]/chat/route"
import { encryptDeviceIdentity, generateDeviceIdentity } from "@/lib/openclaw/device-identity"

const params = (id = "ws-1") => ({ params: Promise.resolve({ id }) })
const post = (body: unknown, id = "ws-1") =>
  POST(createMockRequest(`http://localhost/api/workspaces/${id}/chat`, { method: "POST", body }), params(id))

const mockSend = vi.fn()

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
  mockSend.mockResolvedValue({ ok: true, runId: "idem-xyz", status: "started", paired: false })
  __setChatRouteDepsForTests({ send: mockSend })
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
    ["HIBERNATED", 409, "WORKSPACE_HIBERNATED"],
    ["STOPPED", 409, "WORKSPACE_STOPPED"],
    ["DEPLOYING", 409, "WORKSPACE_TRANSITIONING"],
    ["WAKING", 409, "WORKSPACE_TRANSITIONING"],
    ["DRAFT", 409, "WORKSPACE_TRANSITIONING"],
  ])("status %s → %i %s, gateway never contacted", async (status, code, errCode) => {
    ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(workspaceRow({ status }))
    const res = await post({ message: "hi" })
    const { status: httpStatus, data } = await parseResponse(res)
    expect(httpStatus).toBe(code)
    expect(data.error.code).toBe(errCode)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it("RUNNING → proceeds to send (202)", async () => {
    const res = await post({ message: "hi" })
    expect(res.status).toBe(202)
    expect(mockSend).toHaveBeenCalledTimes(1)
  })

  it("ERROR → attempts the send (recovery path)", async () => {
    ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(workspaceRow({ status: "ERROR" }))
    await post({ message: "hi" })
    expect(mockSend).toHaveBeenCalledTimes(1)
  })

  it("amendment-2: RUNNING but missing containerHost/gatewayToken → 502 GATEWAY_UNREACHABLE, no send", async () => {
    ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(workspaceRow({ containerHost: null }))
    const { status, data } = await parseResponse(await post({ message: "hi" }))
    expect(status).toBe(502)
    expect(data.error.code).toBe("GATEWAY_UNREACHABLE")
    expect(mockSend).not.toHaveBeenCalled()
  })

  // ─── Error-code mapping (amendment 1) ────────────────────────────────────
  it("send unreachable → 502 GATEWAY_UNREACHABLE", async () => {
    mockSend.mockResolvedValue({ ok: false, reason: "unreachable", detail: "x" })
    const { status, data } = await parseResponse(await post({ message: "hi" }))
    expect(status).toBe(502)
    expect(data.error.code).toBe("GATEWAY_UNREACHABLE")
  })

  it("send transitioning → 409 WORKSPACE_TRANSITIONING", async () => {
    mockSend.mockResolvedValue({ ok: false, reason: "transitioning", detail: "starting" })
    const { status, data } = await parseResponse(await post({ message: "hi" }))
    expect(status).toBe(409)
    expect(data.error.code).toBe("WORKSPACE_TRANSITIONING")
  })

  // ─── V4 lazy keygen: persists exactly once, reused thereafter ────────────
  it("first send (no device key) generates + persists exactly once", async () => {
    await post({ message: "hi" })
    expect(prismaMock.workspace.update).toHaveBeenCalledTimes(1)
    const call = (prismaMock.workspace.update as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.data.chatDeviceKeyEncrypted).toEqual(expect.any(String))
  })

  it("subsequent send (device key present) reuses it - no persist", async () => {
    const blob = encryptDeviceIdentity(generateDeviceIdentity())
    ;(prismaMock.workspace.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(workspaceRow({ chatDeviceKeyEncrypted: blob }))
    await post({ message: "hi" })
    expect(prismaMock.workspace.update).not.toHaveBeenCalled()
    expect(mockSend).toHaveBeenCalledTimes(1)
  })

  // ─── V3: route writes NO ActivityLog row ─────────────────────────────────
  it("writes NO ActivityLog row (container hook owns the canonical row)", async () => {
    await post({ message: "hi" })
    expect(prismaMock.activityLog.create).not.toHaveBeenCalled()
  })

  // ─── V6: at most one retry, SAME idempotencyKey ──────────────────────────
  it("retries once on unreachable with the SAME idempotencyKey, then succeeds", async () => {
    mockSend
      .mockResolvedValueOnce({ ok: false, reason: "unreachable", detail: "transient" })
      .mockResolvedValueOnce({ ok: true, runId: "idem-xyz", status: "started", paired: false })
    const res = await post({ message: "hi" })
    expect(res.status).toBe(202)
    expect(mockSend).toHaveBeenCalledTimes(2)
    const key1 = mockSend.mock.calls[0][0].idempotencyKey
    const key2 = mockSend.mock.calls[1][0].idempotencyKey
    expect(key1).toBe(key2) // V6: never a fresh key on retry
  })

  it("does not retry more than once (two unreachable → single failure)", async () => {
    mockSend.mockResolvedValue({ ok: false, reason: "unreachable", detail: "down" })
    const res = await post({ message: "hi" })
    expect(res.status).toBe(502)
    expect(mockSend).toHaveBeenCalledTimes(2) // initial + exactly one retry
  })

  it("202 body shape is { runId }", async () => {
    const { status, data } = await parseResponse(await post({ message: "hi" }))
    expect(status).toBe(202)
    expect(data.success).toBe(true)
    expect(data.data).toEqual({ runId: "idem-xyz" })
  })
})
