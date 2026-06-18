// PR-1: locks the invariant that keeps the accepted cross-process sync race
// benign — /api/internal/state/upload MUST persist the snapshot with a SINGLE
// atomic updateMany (one-shot column write), never a read-modify-write. If the
// row write is atomic, two concurrent uploads (e.g. the gateway-process
// /internal/sync-now and the parent-process 5-min interval) can only produce an
// equal-or-fresher snapshot — never a torn/partial row.
//
// Mutation: refactor the route into findUnique→mutate→update (read-modify-write)
// and this test fails (read methods get called / updateMany doesn't).

import { describe, it, expect, beforeEach, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { NextRequest } from "next/server"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))
vi.mock("@/lib/logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { POST } from "@/app/api/internal/state/upload/route"

const SECRET = "test-master-secret"

function uploadReq(body: Record<string, unknown>, secret = SECRET): NextRequest {
  return new NextRequest("http://localhost/api/internal/state/upload", {
    method: "POST",
    headers: { "X-Metering-Secret": secret, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/internal/state/upload — atomic single-column write", () => {
  beforeEach(() => {
    process.env.METERING_MASTER_SECRET = SECRET
    ;(prismaMock.containerState.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 })
  })

  it("persists via ONE updateMany and performs NO read-modify-write", async () => {
    const res = await POST(
      uploadReq({
        workspaceId: "ws-1",
        compressedState: Buffer.from("gz").toString("base64"),
        uncompressedSize: 2,
      }),
    )
    expect(res.status).toBe(200)

    // The atomic write: exactly one updateMany.
    expect(prismaMock.containerState.updateMany).toHaveBeenCalledTimes(1)
    const call = (prismaMock.containerState.updateMany as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(call.where).toEqual({ workspaceId: "ws-1" })
    expect(call.data).toHaveProperty("runtimeStateSnapshot")
    expect(call.data).toHaveProperty("runtimeStateUpdatedAt")

    // NO read-modify-write: none of these may be used to persist the snapshot.
    expect(prismaMock.containerState.findUnique).not.toHaveBeenCalled()
    expect(prismaMock.containerState.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.containerState.update).not.toHaveBeenCalled()
  })

  it("rejects a wrong/absent secret with 401 (no DB write)", async () => {
    const res = await POST(uploadReq({ workspaceId: "ws-1", compressedState: "x" }, "wrong"))
    expect(res.status).toBe(401)
    expect(prismaMock.containerState.updateMany).not.toHaveBeenCalled()
  })
})
