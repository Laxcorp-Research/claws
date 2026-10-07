import { mkdtemp, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

import { POST } from "@/app/api/internal/state/disk/route"
import { readRuntimeSnapshotFromDisk } from "@/lib/openclaw/snapshot-disk"
import { persistRuntimeStateSnapshot } from "@/lib/openclaw/state-snapshot"

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "claws-snap-"))
  process.env.CLAWS_SNAPSHOT_DIR = dir
  process.env.METERING_MASTER_SECRET = "meter"
  delete process.env.CLAWS_PROFILE
  ;(prismaMock.$executeRaw as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(1)
})

afterEach(async () => {
  delete process.env.CLAWS_PROFILE
  delete process.env.CLAWS_SNAPSHOT_DIR
  delete process.env.METERING_MASTER_SECRET
  await rm(dir, { recursive: true, force: true })
})

describe("snapshot-to-disk", () => {
  it("self-host persist round-trips the same bytes to disk and still writes Postgres", async () => {
    process.env.CLAWS_PROFILE = "self-host"
    const bytes = Buffer.from("snapshot-bytes")
    const result = await persistRuntimeStateSnapshot({
      workspaceId: "ws-disk",
      stateBuffer: bytes,
      uncompressedSize: bytes.length,
    })
    expect(result.count).toBe(1)
    expect(prismaMock.$executeRaw).toHaveBeenCalled()
    const read = await readRuntimeSnapshotFromDisk("ws-disk")
    expect(Buffer.compare(read, bytes)).toBe(0)
  })

  it("hosted persist does not write a snapshot file", async () => {
    const bytes = Buffer.from("hosted-only")
    await persistRuntimeStateSnapshot({
      workspaceId: "ws-hosted",
      stateBuffer: bytes,
      uncompressedSize: bytes.length,
    })
    await expect(stat(join(dir, "ws-hosted.bin"))).rejects.toThrow()
  })

  it("disk ingest is 404 when the profile is hosted", async () => {
    const req = new Request("http://localhost/api/internal/state/disk", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Metering-Secret": "meter" },
      body: JSON.stringify({ workspaceId: "ws-disk", bytesBase64: Buffer.from("x").toString("base64") }),
    })
    const res = await POST(req as never)
    expect(res.status).toBe(404)
  })

  it("self-host disk ingest stores the bytes", async () => {
    process.env.CLAWS_PROFILE = "self-host"
    const payload = Buffer.from("from-container")
    const req = new Request("http://localhost/api/internal/state/disk", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Metering-Secret": "meter" },
      body: JSON.stringify({
        workspaceId: "ws-disk",
        bytesBase64: payload.toString("base64"),
        uncompressedSize: payload.length,
      }),
    })
    const res = await POST(req as never)
    expect(res.status).toBe(200)
    const read = await readRuntimeSnapshotFromDisk("ws-disk")
    expect(Buffer.compare(read, payload)).toBe(0)
  })
})
