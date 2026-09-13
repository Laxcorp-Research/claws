import { describe, it, expect, beforeEach, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { NextRequest } from "next/server"
import { createHash } from "crypto"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))
vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const mockExtractDeliverables = vi.fn().mockRejectedValue(new Error("extract boom"))
vi.mock("@/lib/artifacts/extract-deliverables", () => ({
  extractDeliverablesFromGzip: (...args: unknown[]) => mockExtractDeliverables(...args),
}))

const SECRET = "test-master-secret"

function sha256Hex(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex")
}

function req(url: string, body: Record<string, unknown>, secret = SECRET): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "X-Metering-Secret": secret, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("POST /api/internal/state/finalize - persist + idempotency + del", () => {
  beforeEach(() => {
    process.env.METERING_MASTER_SECRET = SECRET
    mockExtractDeliverables.mockClear()
    mockExtractDeliverables.mockRejectedValue(new Error("extract boom"))
    // persistRuntimeStateSnapshot is now a single raw UPDATE (generation
    // shift rides the same statement) - see state-snapshot.ts.
    ;(prismaMock.$executeRaw as ReturnType<typeof vi.fn>).mockResolvedValue(1)
    ;(prismaMock.containerState.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null)
  })

  it("happy path persists via ONE atomic UPDATE when sha256 matches", async () => {
    const { createFinalizeHandler } = await import("@/app/api/internal/state/finalize/route")
    const gz = Buffer.from("gzip-payload-bytes")
    const digest = sha256Hex(gz)
    const deleteBlob = vi.fn(async () => {})
    const POST = createFinalizeHandler({
      fetchBlobBytes: async () => gz,
      deleteBlob,
    })
    const res = await POST(
      req("http://localhost/api/internal/state/finalize", {
        workspaceId: "ws-big",
        blobUrl: "https://test.public.blob.vercel-storage.com/runtime-state/ws-big/x.gz",
        sha256: digest,
        uncompressedSize: 100,
      }),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.count).toBe(1)
    expect(json.noop).toBe(false)
    expect(json.sha256).toBe(digest)
    expect(prismaMock.$executeRaw).toHaveBeenCalledTimes(1)
    // Read-modify-write of snapshot columns stays banned.
    expect(prismaMock.containerState.update).not.toHaveBeenCalled()
    expect(prismaMock.containerState.updateMany).not.toHaveBeenCalled()
    expect(deleteBlob).toHaveBeenCalledTimes(1)
    expect(mockExtractDeliverables).toHaveBeenCalledTimes(1)
  })

  it("flipped sha256 → runtimeStateUpdatedAt must NOT advance (no persist UPDATE)", async () => {
    const { createFinalizeHandler } = await import("@/app/api/internal/state/finalize/route")
    const gz = Buffer.from("real-bytes")
    const wrong = sha256Hex(Buffer.from("other-bytes"))
    const deleteBlob = vi.fn(async () => {})
    const POST = createFinalizeHandler({
      fetchBlobBytes: async () => gz,
      deleteBlob,
    })
    const res = await POST(
      req("http://localhost/api/internal/state/finalize", {
        workspaceId: "ws-1",
        blobUrl: "https://test.public.blob.vercel-storage.com/x.gz",
        sha256: wrong,
        uncompressedSize: 10,
      }),
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error).toBe("SHA256_MISMATCH")
    // Mutation: remove the hash check → the persist UPDATE would fire.
    expect(prismaMock.$executeRaw).not.toHaveBeenCalled()
    expect(deleteBlob).not.toHaveBeenCalled()
  })

  it("idempotent finalize: same (workspaceId, sha256) → 200 noop, no second persist UPDATE", async () => {
    const { createFinalizeHandler } = await import("@/app/api/internal/state/finalize/route")
    const gz = Buffer.from("same-snapshot")
    const digest = sha256Hex(gz)
    ;(prismaMock.containerState.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      runtimeStateSnapshot: new Uint8Array(gz),
    })
    const deleteBlob = vi.fn(async () => {})
    const POST = createFinalizeHandler({
      fetchBlobBytes: async () => gz,
      deleteBlob,
    })
    const res = await POST(
      req("http://localhost/api/internal/state/finalize", {
        workspaceId: "ws-1",
        blobUrl: "https://test.public.blob.vercel-storage.com/dup.gz",
        sha256: digest,
        uncompressedSize: 12,
      }),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.noop).toBe(true)
    // Mutation: remove the noop/existingSha check → a second persist UPDATE
    // would fire AND needlessly shift the previous generation.
    expect(prismaMock.$executeRaw).not.toHaveBeenCalled()
    expect(deleteBlob).toHaveBeenCalledTimes(1)
  })

  it("persist succeeds even when del() throws", async () => {
    const { createFinalizeHandler } = await import("@/app/api/internal/state/finalize/route")
    const gz = Buffer.from("keep-me")
    const digest = sha256Hex(gz)
    const deleteBlob = vi.fn(async () => {
      throw new Error("blob del failed")
    })
    const POST = createFinalizeHandler({
      fetchBlobBytes: async () => gz,
      deleteBlob,
    })
    const res = await POST(
      req("http://localhost/api/internal/state/finalize", {
        workspaceId: "ws-1",
        blobUrl: "https://test.public.blob.vercel-storage.com/x.gz",
        sha256: digest,
        uncompressedSize: 7,
      }),
    )
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.success).toBe(true)
    expect(json.count).toBe(1)
    expect(prismaMock.$executeRaw).toHaveBeenCalledTimes(1)
    expect(deleteBlob).toHaveBeenCalledTimes(1)
  })
})
