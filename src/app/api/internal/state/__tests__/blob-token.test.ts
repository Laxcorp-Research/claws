import { describe, it, expect, beforeEach, vi } from "vitest"
import { NextRequest } from "next/server"

const generateMock = vi.fn(async (_opts?: unknown) => "generated-client-token")

vi.mock("@vercel/blob/client", () => ({
  generateClientTokenFromReadWriteToken: (opts: unknown) => generateMock(opts),
}))

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const findWorkspace = vi.fn()
vi.mock("@/lib/db", () => ({
  prisma: {
    workspace: {
      findUnique: (...args: unknown[]) => findWorkspace(...args),
      update: vi.fn(),
    },
  },
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
    delete process.env.CLAWS_PROFILE
    process.env.METERING_MASTER_SECRET = SECRET
    process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_storeTEST_secrettokenvalue"
    generateMock.mockClear()
    generateMock.mockResolvedValue("generated-client-token")
    findWorkspace.mockReset()
    findWorkspace.mockResolvedValue(null)
  })

  it("self-host returns 200 for the workspace secret and 401 with none, without Vercel Blob", async () => {
    process.env.CLAWS_PROFILE = "self-host"
    process.env.CONTROL_PLANE_INTERNAL_URL = "http://app:3000"
    delete process.env.BLOB_READ_WRITE_TOKEN
    const { encrypt } = await import("@/lib/encryption")
    findWorkspace.mockResolvedValue({ syncSecretEncrypted: encrypt("workspace-sync-secret") })
    const { POST } = await import("@/app/api/internal/state/blob-token/route")
    const denied = await POST(
      req(
        { workspaceId: "ws-1", sha256: "ab".repeat(32), compressedSize: 128 },
        "nope",
      ),
    )
    expect(denied.status).toBe(401)
    expect(generateMock).not.toHaveBeenCalled()
    const ok = await POST(
      req(
        { workspaceId: "ws-1", sha256: "ab".repeat(32), compressedSize: 128 },
        "workspace-sync-secret",
      ),
    )
    expect(ok.status).toBe(200)
    const json = await ok.json()
    expect(json.clientToken).toBe("workspace-sync-secret")
    expect(json.apiUrl).toBe("http://app:3000/api/internal/state/blob-put")
    expect(json.pathname).toBe("runtime-state/ws-1.gz")
    expect(generateMock).not.toHaveBeenCalled()
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

  it("accepts a 54MB compressed snapshot (9.4 history under raised cap)", async () => {
    const { POST } = await import("@/app/api/internal/state/blob-token/route")
    const res = await POST(
      req({
        workspaceId: "ws-1",
        sha256: "ab".repeat(32),
        compressedSize: 54 * 1024 * 1024,
      }),
    )
    expect(res.status).toBe(200)
    expect(generateMock).toHaveBeenCalledWith(
      expect.objectContaining({ maximumSizeInBytes: 80 * 1024 * 1024 }),
    )
  })

  it("rejects compressedSize above the 80MB hard cap", async () => {
    const { POST } = await import("@/app/api/internal/state/blob-token/route")
    const res = await POST(
      req({
        workspaceId: "ws-1",
        sha256: "cd".repeat(32),
        compressedSize: 81 * 1024 * 1024,
      }),
    )
    expect(res.status).toBe(400)
    expect(generateMock).not.toHaveBeenCalled()
  })
})
