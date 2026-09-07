import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { createMockRequest, parseResponse } from "@/test/helpers/mock-request"
import { readFileSync } from "node:fs"
import { join } from "node:path"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))
vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { POST } from "@/app/api/internal/http-action/[workspaceId]/route"

const SECRET = "test_http_action_secret"
const WORKSPACE_ID = "ws-http-1"
const order = {
  side: "buy",
  qty: "166",
  symbol: "MU",
  limit_price: "1017",
  stop_price: "1005",
}

function call(body: unknown, opts: { secret?: string; workspaceId?: string } = {}) {
  const headers: Record<string, string> = {}
  if (opts.secret !== undefined) headers["X-Activity-Secret"] = opts.secret
  const wsId = opts.workspaceId ?? WORKSPACE_ID
  return POST(
    createMockRequest(`http://localhost:3000/api/internal/http-action/${wsId}`, {
      method: "POST",
      headers,
      body,
    }),
    { params: Promise.resolve({ workspaceId: wsId }) },
  )
}

describe("POST /api/internal/http-action/[workspaceId]", () => {
  let prevSecret: string | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    prevSecret = process.env.ACTIVITY_PIPELINE_SECRET
    process.env.ACTIVITY_PIPELINE_SECRET = SECRET
    ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: WORKSPACE_ID,
      deliveryMode: "APPROVAL_REQUIRED",
    })
    ;(prismaMock.activityLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([])
    ;(prismaMock.activityLog.create as ReturnType<typeof vi.fn>).mockImplementation(
      async (args: { data: { actionType: string } }) => ({
        id: args.data.actionType === "HUMAN_REQUEST" ? "hr-http" : "ledger-1",
      }),
    )
    ;(prismaMock.activityLog.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 })
  })

  afterEach(() => {
    if (prevSecret === undefined) delete process.env.ACTIVITY_PIPELINE_SECRET
    else process.env.ACTIVITY_PIPELINE_SECRET = prevSecret
  })

  it("returns 401 when the activity secret is missing or wrong", async () => {
    expect((await parseResponse(await call({ op: "gate", skill: "tavily-search", method: "POST" }))).status).toBe(401)
    expect(
      (await parseResponse(await call({ op: "gate", skill: "tavily-search", method: "POST" }, { secret: "nope" }))).status,
    ).toBe(401)
  })

  it("READ is allowed and returns a tool id", async () => {
    const { status, data } = await parseResponse(
      await call(
        {
          op: "gate",
          skill: "tavily-search",
          method: "POST",
          url: "https://api.tavily.com/search",
          body: { query: "micron" },
        },
        { secret: SECRET },
      ),
    )
    expect(status).toBe(200)
    expect(data.data.status).toBe("allow")
    expect(data.data.class).toBe("READ")
    expect(data.data.toolId).toMatch(/^tool:tavily-search:/)
  })

  it("ACTION under ALERT-ONLY is denied+pending and writes a HUMAN_REQUEST card", async () => {
    const { status, data } = await parseResponse(
      await call(
        {
          op: "gate",
          skill: "alpaca-trading",
          method: "POST",
          host: "paper-api.alpaca.markets",
          path: "/v2/orders",
          body: order,
        },
        { secret: SECRET },
      ),
    )
    expect(status).toBe(200)
    expect(data.data.status).toBe("pending")
    expect(data.data.card.bodyPlain).toBe("BUY 166 MU @ $1,017 stop $1,005")
    expect(data.data.requestId).toBe("hr-http")
    expect(prismaMock.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ actionType: "HUMAN_REQUEST" }),
      }),
    )
  })

  it("LLM Authorization header is rejected", async () => {
    const { data } = await parseResponse(
      await call(
        {
          op: "gate",
          skill: "twitter-api",
          method: "GET",
          url: "https://api.twitter.com/2/tweets/search/recent",
          headers: { Authorization: "Bearer forged" },
        },
        { secret: SECRET },
      ),
    )
    expect(data.data).toMatchObject({ status: "deny", reason: "caller_auth" })
  })

  it("undeclared host is denied", async () => {
    const { data } = await parseResponse(
      await call(
        {
          op: "gate",
          skill: "twitter-api",
          method: "GET",
          url: "https://example.com/steal",
        },
        { secret: SECRET },
      ),
    )
    expect(data.data).toMatchObject({ status: "deny", reason: "undeclared" })
  })

  it("payload-less ACTION does not create a request card", async () => {
    const { data } = await parseResponse(
      await call(
        {
          op: "gate",
          skill: "alpaca-trading",
          method: "POST",
          url: "https://paper-api.alpaca.markets/v2/orders",
          body: {},
        },
        { secret: SECRET },
      ),
    )
    expect(data.data).toMatchObject({ status: "deny", reason: "missing_body" })
    const humanRequests = (prismaMock.activityLog.create as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call) => (call[0] as { data?: { actionType?: string } })?.data?.actionType === "HUMAN_REQUEST",
    )
    expect(humanRequests).toHaveLength(0)
  })

  it("approved permit allows one ACTION then consumes; replay and different body deny", async () => {
    const { buildHttpPermit } = await import("@/lib/openclaw/http-permit")
    const { buildHttpActionCard } = await import("@/lib/openclaw/http-action-card")
    const { httpBodyHash } = await import("@/lib/openclaw/http-ledger")
    const card = buildHttpActionCard({
      skill: "alpaca-trading",
      method: "POST",
      host: "paper-api.alpaca.markets",
      path: "/v2/orders",
      body: order,
    })
    const unused = {
      id: "ha-1",
      metadata: JSON.stringify({
        eventKind: "http_permit",
        originalRequestId: "hr-http",
        httpPermit: buildHttpPermit({ card, bodyHash: httpBodyHash(order) }),
      }),
    }
    ;(prismaMock.activityLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([unused])

    const first = await parseResponse(
      await call(
        {
          op: "gate",
          skill: "alpaca-trading",
          method: "POST",
          url: "https://paper-api.alpaca.markets/v2/orders",
          body: order,
        },
        { secret: SECRET },
      ),
    )
    expect(first.data.data.status).toBe("allow")
    expect(first.data.data.class).toBe("ACTION")
    expect(prismaMock.activityLog.updateMany).toHaveBeenCalled()

    const consumed = {
      id: "ha-1",
      metadata: JSON.stringify({
        eventKind: "http_permit",
        originalRequestId: "hr-http",
        httpPermit: { ...buildHttpPermit({ card, bodyHash: httpBodyHash(order) }), consumedAt: "2026-09-07T00:00:00.000Z" },
      }),
    }
    ;(prismaMock.activityLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([consumed])
    const replay = await parseResponse(
      await call(
        {
          op: "gate",
          skill: "alpaca-trading",
          method: "POST",
          url: "https://paper-api.alpaca.markets/v2/orders",
          body: order,
        },
        { secret: SECRET },
      ),
    )
    expect(replay.data.data).toMatchObject({ status: "deny", reason: "permit_consumed" })

    ;(prismaMock.activityLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([unused])
    const swapped = await parseResponse(
      await call(
        {
          op: "gate",
          skill: "alpaca-trading",
          method: "POST",
          url: "https://paper-api.alpaca.markets/v2/orders",
          body: { ...order, qty: "1" },
        },
        { secret: SECRET },
      ),
    )
    expect(swapped.data.data).toMatchObject({ status: "deny", reason: "permit_mismatch" })
  })

  it("rejects container-forged approve ops", async () => {
    const { status, data } = await parseResponse(
      await call({ op: "approve", skill: "alpaca-trading" }, { secret: SECRET }),
    )
    expect(status).toBe(400)
    expect(data.error?.message ?? data.message ?? "").toMatch(/gate or ledger/i)
  })

  it("MUTATION: route must not write HUMAN_APPROVE", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/api/internal/http-action/[workspaceId]/route.ts"),
      "utf8",
    )
    expect(src).not.toContain("HUMAN_APPROVE")
    expect(src).not.toContain("HUMAN_REJECT")
  })
})
