import { describe, it, expect, vi, beforeEach } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { createMockRequest, parseResponse } from "@/test/helpers/mock-request"
import { formatActivityLog, type ActivityLogFormatInput } from "@/lib/activity-log-format"
import { chatRunStateQueryWhere } from "@/lib/chat/run-state"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))
vi.mock("@/lib/api/auth", () => ({
  getSessionUser: vi.fn().mockResolvedValue({ id: "user-1", email: "u@test.com" }),
}))
vi.mock("@/lib/api/ownership", () => ({
  verifyWorkspaceOwnership: vi.fn().mockResolvedValue({
    error: null,
    workspace: { id: "ws-1", userId: "user-1" },
  }),
}))

import { GET } from "@/app/api/workspaces/[id]/chat/run-state/route"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"

const params = (id = "ws-1") => ({ params: Promise.resolve({ id }) })
const get = (query = "", id = "ws-1") =>
  GET(
    createMockRequest(`http://localhost/api/workspaces/${id}/chat/run-state${query}`, {
      method: "GET",
    }),
    params(id),
  )

const row = (overrides: Partial<ActivityLogFormatInput> = {}): ActivityLogFormatInput => ({
  id: "log-1",
  timestamp: new Date("2026-09-04T08:00:00.000Z"),
  agentName: "Orchestrator",
  agentSlug: "orchestrator",
  action: "Replied: hi",
  detail: "hi",
  actionType: "MESSAGE_SENT",
  apiCost: null,
  metadata: JSON.stringify({ channelId: "webchat", runId: "run-1" }),
  ...overrides,
})

beforeEach(() => {
  vi.clearAllMocks()
  ;(getSessionUser as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "user-1", email: "u@test.com" })
  ;(verifyWorkspaceOwnership as ReturnType<typeof vi.fn>).mockResolvedValue({
    error: null,
    workspace: { id: "ws-1", userId: "user-1" },
  })
  ;(prismaMock.activityLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([] as never)
})

describe("GET /api/workspaces/[id]/chat/run-state", () => {
  it("401 when unauthenticated", async () => {
    ;(getSessionUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)
    expect((await get()).status).toBe(401)
    expect(prismaMock.activityLog.findMany).not.toHaveBeenCalled()
  })

  it("404 / 403 from ownership", async () => {
    ;(verifyWorkspaceOwnership as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      error: "NOT_FOUND",
      workspace: null,
    })
    expect((await get()).status).toBe(404)

    ;(verifyWorkspaceOwnership as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      error: "FORBIDDEN",
      workspace: null,
    })
    expect((await get()).status).toBe(403)
  })

  it("returns formatted rows for the requested runIds (including channelId-less replies)", async () => {
    const reply = row({
      id: "sent-1",
      metadata: JSON.stringify({ runId: "run-1" }),
    })
    ;(prismaMock.activityLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([reply] as never)

    const { status, data } = await parseResponse(await get("?runIds=run-1"))
    expect(status).toBe(200)
    expect(prismaMock.activityLog.findMany).toHaveBeenCalledWith({
      where: chatRunStateQueryWhere("ws-1", { runIds: ["run-1"], since: null }),
      orderBy: [{ timestamp: "asc" }, { id: "asc" }],
      take: 100,
    })
    expect(data.data.rows).toEqual([formatActivityLog(reply)])
    expect(data.data.rows[0].runId).toBe("run-1")
  })

  it("honors since= for catch-up after an SSE drop", async () => {
    await get("?since=2026-09-04T08:00:00.000Z&runIds=run-1")
    expect(prismaMock.activityLog.findMany).toHaveBeenCalledWith({
      where: chatRunStateQueryWhere("ws-1", {
        runIds: ["run-1"],
        since: new Date("2026-09-04T08:00:00.000Z"),
      }),
      orderBy: [{ timestamp: "asc" }, { id: "asc" }],
      take: 100,
    })
  })
})
