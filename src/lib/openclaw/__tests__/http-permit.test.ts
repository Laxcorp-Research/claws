import { beforeEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

import {
  buildHttpPermit,
  consumeHttpPermit,
  HTTP_PERMIT_EVENT_KIND,
  issueHttpPermitOnApprove,
  parseHttpPermit,
  resolveHttpPermit,
} from "@/lib/openclaw/http-permit"
import { httpBodyHash } from "@/lib/openclaw/http-ledger"
import { buildHttpActionCard } from "@/lib/openclaw/http-action-card"

const card = buildHttpActionCard({
  skill: "alpaca-trading",
  method: "POST",
  host: "paper-api.alpaca.markets",
  path: "/v2/orders",
  body: { side: "buy", qty: "166", symbol: "MU", limit_price: "1017", stop_price: "1005" },
})
const body = { side: "buy", qty: "166", symbol: "MU", limit_price: "1017", stop_price: "1005" }
const bodyHash = httpBodyHash(body)

function permitRow(consumedAt: string | null, hash = bodyHash) {
  const permit = { ...buildHttpPermit({ card, bodyHash: hash }), consumedAt }
  return {
    id: consumedAt ? "ha-used" : "ha-open",
    metadata: JSON.stringify({
      eventKind: HTTP_PERMIT_EVENT_KIND,
      originalRequestId: "hr-1",
      httpPermit: permit,
    }),
  }
}

describe("http one-shot permit", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("issues a permit bound to the approved body hash", async () => {
    ;(prismaMock.activityLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "ha-1" })
    const issued = await issueHttpPermitOnApprove({
      workspaceId: "ws-1",
      requestId: "hr-1",
      respondedBy: "founder@test.com",
      card,
      bodyHash,
    })
    expect(issued.permit.consumedAt).toBeNull()
    expect(issued.permit.bodyHash).toBe(bodyHash)
    expect(prismaMock.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actionType: "HUMAN_APPROVE",
          metadata: expect.stringContaining(HTTP_PERMIT_EVENT_KIND),
        }),
      }),
    )
  })

  it("resolve prefers unused endpoint permit; consumed exact-body is replay", async () => {
    ;(prismaMock.activityLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([permitRow(null)])
    const unused = await resolveHttpPermit({
      workspaceId: "ws-1",
      skill: "alpaca-trading",
      method: "POST",
      host: "paper-api.alpaca.markets",
      path: "/v2/orders",
      body,
    })
    expect(unused.kind).toBe("unused")

    ;(prismaMock.activityLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      permitRow("2026-09-07T00:00:00.000Z"),
    ])
    const replay = await resolveHttpPermit({
      workspaceId: "ws-1",
      skill: "alpaca-trading",
      method: "POST",
      host: "paper-api.alpaca.markets",
      path: "/v2/orders",
      body,
    })
    expect(replay.kind).toBe("consumed")
  })

  it("consume is one-shot; second consume fails", async () => {
    ;(prismaMock.activityLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([permitRow(null)])
    ;(prismaMock.activityLog.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 })
    const first = await consumeHttpPermit({
      workspaceId: "ws-1",
      skill: "alpaca-trading",
      method: "POST",
      host: "paper-api.alpaca.markets",
      path: "/v2/orders",
      body,
    })
    expect(first.ok).toBe(true)

    ;(prismaMock.activityLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      permitRow("2026-09-07T00:00:00.000Z"),
    ])
    const second = await consumeHttpPermit({
      workspaceId: "ws-1",
      skill: "alpaca-trading",
      method: "POST",
      host: "paper-api.alpaca.markets",
      path: "/v2/orders",
      body,
    })
    expect(second).toEqual({ ok: false, reason: "consumed" })
  })

  it("different body against an unused permit is a mismatch", async () => {
    ;(prismaMock.activityLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([permitRow(null)])
    const result = await consumeHttpPermit({
      workspaceId: "ws-1",
      skill: "alpaca-trading",
      method: "POST",
      host: "paper-api.alpaca.markets",
      path: "/v2/orders",
      body: { ...body, qty: "1" },
    })
    expect(result).toEqual({ ok: false, reason: "mismatch" })
  })

  it("parseHttpPermit reads nested httpPermit metadata", () => {
    const parsed = parseHttpPermit(permitRow(null).metadata)
    expect(parsed?.skill).toBe("alpaca-trading")
    expect(parsed?.consumedAt).toBeNull()
  })
})
