// PR-1 revision: /upload is reject-only (Blob is the sole transport).
// Atomic persist invariant now lives on /finalize (see blob-transport.test.ts).

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

describe("POST /api/internal/state/upload — reject-only (USE_BLOB)", () => {
  beforeEach(() => {
    process.env.METERING_MASTER_SECRET = SECRET
  })

  it("any authenticated POST → 413 USE_BLOB and performs NO DB write", async () => {
    const res = await POST(
      uploadReq({
        workspaceId: "ws-1",
        compressedState: Buffer.from("gz").toString("base64"),
        uncompressedSize: 2,
      }),
    )
    expect(res.status).toBe(413)
    const json = await res.json()
    expect(json.code).toBe("USE_BLOB")
    expect(prismaMock.containerState.updateMany).not.toHaveBeenCalled()
    expect(prismaMock.containerState.findUnique).not.toHaveBeenCalled()
  })

  it("rejects a wrong/absent secret with 401 (no DB write)", async () => {
    const res = await POST(uploadReq({ workspaceId: "ws-1", compressedState: "x" }, "wrong"))
    expect(res.status).toBe(401)
    expect(prismaMock.containerState.updateMany).not.toHaveBeenCalled()
  })
})
