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

  it("false-empty regression: returns webchat rows even when 50 newer non-chat rows would crowd out SSE init", async () => {
    const crowdedOutBySseInit = Array.from({ length: 50 }, (_, i) =>
      row({
        id: `task-${i}`,
        timestamp: new Date(`2026-06-22T09:${String(i).padStart(2, "0")}:00.000Z`),
        actionType: i % 2 === 0 ? "TASK_START" : "TASK_COMPLETE",
        action: "Non-chat activity",
        detail: "Non-chat activity",
        metadata: JSON.stringify({ source: "heartbeat" }),
      }),
    )
    const olderWebchat = row({
      id: "webchat-old",
      timestamp: new Date("2026-06-22T08:00:00.000Z"),
      detail: "old chat still visible",
      metadata: JSON.stringify({
        from: "",
        messageId: "run-old-chat",
        channelId: "webchat",
        runId: null,
      }),
    })
    ;(prismaMock.activityLog.findMany as ReturnType<typeof vi.fn>).mockImplementation((args: {
      where?: { AND?: Array<{ OR?: Array<{ metadata?: { contains?: string } }> }> }
    }) => {
      const or = args.where?.AND?.[0]?.OR ?? []
      if (or.some((clause) => clause.metadata?.contains === '"channelId":"webchat"')) {
        return Promise.resolve([olderWebchat] as never)
      }
      return Promise.resolve(crowdedOutBySseInit as never)
    })

    const { status, data } = await parseResponse(await get("?limit=25"))

    expect(prismaMock.activityLog.findMany).toHaveBeenCalledWith({
      where: {
        workspaceId: "ws-1",
        AND: [
          {
            OR: [
              {
                actionType: { in: ["MESSAGE_RECEIVED", "MESSAGE_SENT"] },
                metadata: { contains: '"channelId":"webchat"' },
              },
              {
                actionType: "SYSTEM",
                metadata: { contains: '"eventKind":"deliverable_extracted"' },
              },
              {
                actionType: "SYSTEM",
                metadata: { contains: '"eventKind":"chat_send_held"' },
              },
            ],
          },
        ],
      },
      orderBy: [{ timestamp: "desc" }, { id: "desc" }],
      take: 26,
    })
    expect(status).toBe(200)
    expect(data.data.rows).toEqual([formatActivityLog(olderWebchat)])
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
        AND: [
          {
            OR: [
              {
                actionType: { in: ["MESSAGE_RECEIVED", "MESSAGE_SENT"] },
                metadata: { contains: '"channelId":"webchat"' },
              },
              {
                actionType: "SYSTEM",
                metadata: { contains: '"eventKind":"deliverable_extracted"' },
              },
              {
                actionType: "SYSTEM",
                metadata: { contains: '"eventKind":"chat_send_held"' },
              },
            ],
          },
          {
            OR: [
              { timestamp: { lt: new Date("2026-06-22T08:01:00.000Z") } },
              { timestamp: new Date("2026-06-22T08:01:00.000Z"), id: { lt: "b" } },
            ],
          },
        ],
      },
      orderBy: [{ timestamp: "desc" }, { id: "desc" }],
      take: 3,
    })
  })

  it("returns persisted chat_send_held SYSTEM rows so a refresh does not vanish the send", async () => {
    const held = row({
      id: "hold-1",
      action: "Chat send held",
      actionType: "SYSTEM",
      detail: "hello while asleep",
      metadata: JSON.stringify({
        eventKind: "chat_send_held",
        holdStatus: "held",
        holdReason: "HIBERNATED",
        runId: "run-hold",
      }),
    })
    ;(prismaMock.activityLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([held] as never)
    const { status, data } = await parseResponse(await get())
    expect(status).toBe(200)
    expect(data.data.rows).toEqual([formatActivityLog(held)])
    expect(data.data.rows[0].eventKind).toBe("chat_send_held")
    expect(data.data.rows[0].holdStatus).toBe("held")
    expect(data.data.rows[0].runId).toBe("run-hold")
  })

  it("a deliverable whose body starts with a schema block previews the first non-schema paragraph", async () => {
    const stored = row({
      id: "doc-1",
      action: "Deliverable extracted: x-content-cycle",
      actionType: "SYSTEM",
      detail: "shared/deliverables/x-content-cycle.md",
      metadata: JSON.stringify({
        eventKind: "deliverable_extracted",
        fileVersionId: "fv-1",
        logicalPath: "shared/deliverables/x-content-cycle.md",
        preview: "# x-content-cycle.md ## Schema - slot: 12 | 16 | 20",
      }),
    })
    ;(prismaMock.activityLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([stored] as never)
    ;(prismaMock.fileVersion.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "fv-1",
        content: [
          "# x-content-cycle.md",
          "",
          "## Schema",
          "- slot: 12 | 16 | 20",
          "- drafts: type, full text, hook pattern",
          "",
          "Friday's cycle is one single and one thread.",
        ].join("\n"),
      },
    ] as never)
    const { status, data } = await parseResponse(await get())
    expect(status).toBe(200)
    expect(data.data.rows[0].preview).toBe("Friday's cycle is one single and one thread.")
  })

  it("400 on an invalid before cursor", async () => {
    const { status, data } = await parseResponse(await get("?before=not-a-cursor"))
    expect(status).toBe(400)
    expect(data.error.code).toBe("INVALID_CURSOR")
    expect(prismaMock.activityLog.findMany).not.toHaveBeenCalled()
  })
})
