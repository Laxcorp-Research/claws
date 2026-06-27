import { describe, it, expect, vi, beforeEach } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { createMockRequest, parseResponse } from "@/test/helpers/mock-request"
import { formatActivityLog, type ActivityLogFormatInput } from "@/lib/activity-log-format"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))
vi.mock("@/lib/api/auth", () => ({
  getSessionUser: vi.fn().mockResolvedValue({ id: "user-1", email: "u@test.com" }),
}))
vi.mock("@/lib/api/ownership", () => ({
  verifyWorkspaceOwnership: vi.fn().mockResolvedValue({ error: null, workspace: { id: "ws-1", userId: "user-1" } }),
}))

import { GET } from "@/app/api/workspaces/[id]/chat/history/route"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"

const params = (id = "ws-1") => ({ params: Promise.resolve({ id }) })
const get = (query = "", id = "ws-1") =>
  GET(createMockRequest(`http://localhost/api/workspaces/${id}/chat/history${query}`, { method: "GET" }), params(id))

const row = (overrides: Partial<ActivityLogFormatInput> = {}): ActivityLogFormatInput => ({
  id: "log-1",
  timestamp: new Date("2026-06-22T08:00:00.000Z"),
  agentName: null,
  agentSlug: null,
  action: "Received from : hello",
  detail: "hello",
  actionType: "MESSAGE_RECEIVED",
  apiCost: null,
  metadata: JSON.stringify({
    from: "",
    messageId: "run-1",
    channelId: "webchat",
    runId: null,
  }),
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

describe("GET /api/workspaces/[id]/chat/history", () => {
  it("401 when unauthenticated", async () => {
    ;(getSessionUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)
    expect((await get()).status).toBe(401)
    expect(prismaMock.activityLog.findMany).not.toHaveBeenCalled()
  })

  it("404 / 403 from ownership", async () => {
    ;(verifyWorkspaceOwnership as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ error: "NOT_FOUND", workspace: null })
    expect((await get()).status).toBe(404)

    ;(verifyWorkspaceOwnership as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ error: "FORBIDDEN", workspace: null })
    expect((await get()).status).toBe(403)
  })

  it("queries only webchat MESSAGE_* rows for this workspace, not the last-50 all-activity window", async () => {
    await get("?limit=25")

    expect(prismaMock.activityLog.findMany).toHaveBeenCalledWith({
      where: {
        workspaceId: "ws-1",
        actionType: { in: ["MESSAGE_RECEIVED", "MESSAGE_SENT"] },
        metadata: { contains: '"channelId":"webchat"' },
      },
      orderBy: [{ timestamp: "desc" }, { id: "desc" }],
      take: 26,
    })
  })

  it("returns oldest-to-newest rows in the same shape as the shared ActivityLog formatter", async () => {
    const newest = row({ id: "new", timestamp: new Date("2026-06-22T08:02:00.000Z"), action: "Replied: hi", actionType: "MESSAGE_SENT", metadata: JSON.stringify({ to: "webchat", channelId: "webchat", runId: "run-1" }) })
    const oldest = row({ id: "old", timestamp: new Date("2026-06-22T08:01:00.000Z") })
    ;(prismaMock.activityLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([newest, oldest] as never)

    const { status, data } = await parseResponse(await get("?limit=10"))

    expect(status).toBe(200)
    expect(data.data.rows).toEqual([
      formatActivityLog(oldest),
      formatActivityLog(newest),
    ])
    expect(data.data.nextCursor).toBeNull()
  })

  it("uses a compound (timestamp,id) before cursor and returns nextCursor when more rows exist", async () => {
    const newest = row({ id: "c", timestamp: new Date("2026-06-22T08:02:00.000Z") })
    const oldestPageRow = row({ id: "b", timestamp: new Date("2026-06-22T08:01:00.000Z") })
    const extra = row({ id: "a", timestamp: new Date("2026-06-22T08:01:00.000Z") })
    ;(prismaMock.activityLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([newest, oldestPageRow, extra] as never)

    const first = await parseResponse(await get("?limit=2"))
    expect(first.data.data.rows.map((r: { id: string }) => r.id)).toEqual(["b", "c"])
    expect(first.data.data.nextCursor).toEqual(expect.any(String))

    ;(prismaMock.activityLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([] as never)
    await get(`?limit=2&before=${encodeURIComponent(first.data.data.nextCursor)}`)

    expect(prismaMock.activityLog.findMany).toHaveBeenLastCalledWith({
      where: {
        workspaceId: "ws-1",
        actionType: { in: ["MESSAGE_RECEIVED", "MESSAGE_SENT"] },
        metadata: { contains: '"channelId":"webchat"' },
        OR: [
          { timestamp: { lt: new Date("2026-06-22T08:01:00.000Z") } },
          { timestamp: new Date("2026-06-22T08:01:00.000Z"), id: { lt: "b" } },
        ],
      },
      orderBy: [{ timestamp: "desc" }, { id: "desc" }],
      take: 3,
    })
  })

  it("400 on an invalid before cursor", async () => {
    const { status, data } = await parseResponse(await get("?before=not-a-cursor"))
    expect(status).toBe(400)
    expect(data.error.code).toBe("INVALID_CURSOR")
    expect(prismaMock.activityLog.findMany).not.toHaveBeenCalled()
  })
})
