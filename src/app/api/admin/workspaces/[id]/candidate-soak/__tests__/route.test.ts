import { describe, it, expect, vi, beforeEach } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { createMockRequest, parseResponse } from "@/test/helpers/mock-request"
import { KEEP_CANARY_WORKSPACE_ID } from "@/lib/openclaw/candidate-soak"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

const mockRequireAdmin = vi.fn()
vi.mock("@/lib/api/admin", () => ({ requireAdmin: () => mockRequireAdmin() }))

const mockLogAdminAction = vi.fn()
vi.mock("@/lib/security/audit-log", () => ({
  logAdminAction: (...args: unknown[]) => mockLogAdminAction(...args),
}))

import { POST } from "@/app/api/admin/workspaces/[id]/candidate-soak/route"

async function callRoute(
  id: string,
  body: Record<string, unknown>,
  env: { CLAWS_ENV?: string } = { CLAWS_ENV: "staging" },
) {
  const prev = process.env.CLAWS_ENV
  if (env.CLAWS_ENV === undefined) delete process.env.CLAWS_ENV
  else process.env.CLAWS_ENV = env.CLAWS_ENV
  try {
    const req = createMockRequest(
      `http://localhost:3000/api/admin/workspaces/${id}/candidate-soak`,
      { method: "POST", body },
    )
    return await POST(req, { params: Promise.resolve({ id }) })
  } finally {
    if (prev === undefined) delete process.env.CLAWS_ENV
    else process.env.CLAWS_ENV = prev
  }
}

beforeEach(() => {
  mockRequireAdmin.mockReset()
  mockRequireAdmin.mockResolvedValue({ id: "admin-1", email: "admin@buildclaws.ai" })
  mockLogAdminAction.mockReset()
  ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "ws-clone",
    candidateRuntimeSoak: false,
    httpFixtureMode: false,
    userMdInterviewCompletedAt: null,
  })
  ;(prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "ws-clone",
    candidateRuntimeSoak: true,
    httpFixtureMode: true,
    userMdInterviewCompletedAt: new Date("2026-09-12T00:00:00Z"),
  })
})

describe("POST /api/admin/workspaces/[id]/candidate-soak", () => {
  it("returns 403 when requireAdmin fails", async () => {
    mockRequireAdmin.mockRejectedValue(new Error("ADMIN_REQUIRED"))
    const res = await callRoute("ws-clone", { enabled: true })
    expect(res.status).toBe(403)
    expect(prismaMock.workspace.update).not.toHaveBeenCalled()
  })

  it("rejects KEEP canary with 400 and does not write", async () => {
    const res = await callRoute(KEEP_CANARY_WORKSPACE_ID, { enabled: true })
    const json = await res.json()
    expect(res.status).toBe(400)
    expect(json.error?.code ?? json.code).toMatch(/KEEP_CANARY/)
    expect(prismaMock.workspace.findUnique).not.toHaveBeenCalled()
    expect(prismaMock.workspace.update).not.toHaveBeenCalled()
  })

  it("rejects production CLAWS_ENV with 403", async () => {
    const res = await callRoute("ws-clone", { enabled: true }, { CLAWS_ENV: "production" })
    expect(res.status).toBe(403)
    expect(prismaMock.workspace.update).not.toHaveBeenCalled()
  })

  it("returns 404 when the workspace is missing", async () => {
    ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const res = await callRoute("ws-missing", { enabled: true })
    expect(res.status).toBe(404)
    expect(prismaMock.workspace.update).not.toHaveBeenCalled()
  })

  it("enables soak, httpFixture, and stamps interview when unset", async () => {
    const res = await callRoute("ws-clone", { enabled: true })
    const { status, data } = await parseResponse(res)
    expect(status).toBe(200)
    const updateArgs = (prismaMock.workspace.update as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(updateArgs.data.candidateRuntimeSoak).toBe(true)
    expect(updateArgs.data.httpFixtureMode).toBe(true)
    expect(updateArgs.data.userMdInterviewCompletedAt).toBeInstanceOf(Date)
    expect(data.data.candidateRuntimeSoak).toBe(true)
    expect(mockLogAdminAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "workspace.candidate-soak",
        targetId: "ws-clone",
        targetType: "workspace",
      }),
    )
  })

  it("does not restamp userMdInterviewCompletedAt when already set", async () => {
    ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "ws-clone",
      candidateRuntimeSoak: false,
      httpFixtureMode: false,
      userMdInterviewCompletedAt: new Date("2026-08-01T00:00:00Z"),
    })
    await callRoute("ws-clone", { enabled: true })
    const updateArgs = (prismaMock.workspace.update as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(updateArgs.data).not.toHaveProperty("userMdInterviewCompletedAt")
  })

  it("honors interviewFree:false and httpFixture:false", async () => {
    await callRoute("ws-clone", {
      enabled: true,
      interviewFree: false,
      httpFixture: false,
    })
    const updateArgs = (prismaMock.workspace.update as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(updateArgs.data).toEqual({
      candidateRuntimeSoak: true,
      httpFixtureMode: false,
    })
  })

  it("disables soak without clearing interview stamp", async () => {
    ;(prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "ws-clone",
      candidateRuntimeSoak: false,
      httpFixtureMode: true,
      userMdInterviewCompletedAt: new Date("2026-08-01T00:00:00Z"),
    })
    await callRoute("ws-clone", { enabled: false })
    const updateArgs = (prismaMock.workspace.update as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(updateArgs.data).toEqual({ candidateRuntimeSoak: false })
  })
})
