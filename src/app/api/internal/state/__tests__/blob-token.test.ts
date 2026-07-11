import { describe, it, expect, beforeEach, vi } from "vitest"
import { NextRequest } from "next/server"

const generateMock = vi.fn(async (_opts?: unknown) => "generated-client-token")

vi.mock("@vercel/blob/client", () => ({
  generateClientTokenFromReadWriteToken: (opts: unknown) => generateMock(opts),
}))

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const SECRET = "test-master-secret"

function req(body: Record<string, unknown>, secret = SECRET): NextRequest {
  return new NextRequest("http://localhost/api/internal/state/blob-token", {
    method: "POST",
    headers: { "X-Metering-Secret": secret, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/internal/state/blob-token", () => {
  beforeEach(() => {
    process.env.METERING_MASTER_SECRET = SECRET
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_storeTEST_secrettokenvalue"
    generateMock.mockClear()
    generateMock.mockResolvedValue("generated-client-token")
  })

  it("auth failure → 401 and generateClientToken is never called (no Blob write possible)", async () => {
    const { POST } = await import("@/app/api/internal/state/blob-token/route")
    const res = await POST(
      req(
        {
          workspaceId: "ws-1",
          sha256: "ab".repeat(32),
          compressedSize: 4_000_000,
        },
        "wrong",
      ),
    )
    expect(res.status).toBe(401)
    expect(generateMock).not.toHaveBeenCalled()
  })

  it("issues clientToken + storeId + pathname on valid auth", async () => {
    const { POST } = await import("@/app/api/internal/state/blob-token/route")
    const res = await POST(
      req({
        workspaceId: "ws-1",
        sha256: "cd".repeat(32),
        compressedSize: 4_000_000,
      }),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.clientToken).toBe("generated-client-token")
    expect(json.storeId).toBe("storeTEST")
    expect(json.pathname).toMatch(/^runtime-state\/ws-1\//)
    expect(generateMock).toHaveBeenCalledTimes(1)
  })
})
