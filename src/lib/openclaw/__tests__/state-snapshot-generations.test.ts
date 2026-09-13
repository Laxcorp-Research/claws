// Snapshot generations contract (RUNTIME-9.4 soak containment).
//
// Founder-claw incident 2026-09-13: ContainerState.runtimeStateSnapshot was a
// single column, so the first 9.4 persist overwrote the last 5.22-shaped
// snapshot - the rollback material was gone the moment migration succeeded.
// persistRuntimeStateSnapshot now shifts current -> previous and pins a
// pre-migration generation inside ONE atomic UPDATE.
//
// These tests lock the statement contract: if someone reverts to the
// single-column overwrite (or splits the persist into read-modify-write),
// they fail.

import { describe, it, expect, beforeEach, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

import { persistRuntimeStateSnapshot } from "@/lib/openclaw/state-snapshot"

type RawCall = [TemplateStringsArray, ...unknown[]]

function sqlTextOf(call: RawCall): string {
  const [strings, ...values] = call
  // Rebuild the full statement: literal template chunks plus any Prisma.raw
  // fragments (which carry their SQL on .strings / .sql).
  let text = ""
  for (let i = 0; i < strings.length; i++) {
    text += strings[i]
    const v = values[i]
    if (v && typeof v === "object" && "strings" in (v as Record<string, unknown>)) {
      text += ((v as { strings: string[] }).strings ?? []).join("")
    }
  }
  return text
}

describe("persistRuntimeStateSnapshot - atomic generation shift", () => {
  beforeEach(() => {
    ;(prismaMock.$executeRaw as ReturnType<typeof vi.fn>).mockResolvedValue(1)
  })

  it("persists via exactly ONE statement (no read-modify-write of snapshot columns)", async () => {
    const result = await persistRuntimeStateSnapshot({
      workspaceId: "ws-gen-1",
      stateBuffer: Buffer.from("snapshot-bytes"),
      uncompressedSize: 1234,
    })
    expect(result).toEqual({ count: 1 })
    expect(prismaMock.$executeRaw).toHaveBeenCalledTimes(1)
    expect(prismaMock.containerState.update).not.toHaveBeenCalled()
    expect(prismaMock.containerState.updateMany).not.toHaveBeenCalled()
    expect(prismaMock.containerState.findUnique).not.toHaveBeenCalled()
  })

  it("shifts current -> previous generation in the SAME statement (founder 5.22-snapshot-overwrite regression)", async () => {
    await persistRuntimeStateSnapshot({
      workspaceId: "ws-gen-1",
      stateBuffer: Buffer.from("snapshot-bytes"),
      uncompressedSize: 1234,
    })
    const sql = sqlTextOf(
      (prismaMock.$executeRaw as ReturnType<typeof vi.fn>).mock.calls[0] as RawCall,
    )
    // col = col assignments read the OLD tuple in Postgres - that IS the
    // atomic shift. Removing any of these reverts to single-generation
    // overwrite and this fails.
    expect(sql).toContain('"runtimeStatePrevSnapshot"  = "runtimeStateSnapshot"')
    expect(sql).toContain('"runtimeStatePrevUpdatedAt" = "runtimeStateUpdatedAt"')
    expect(sql).toContain('"runtimeStatePrevSizeBytes" = "runtimeStateSizeBytes"')
  })

  it("pins a pre-migration generation for 7 days when the deployed contract changed", async () => {
    await persistRuntimeStateSnapshot({
      workspaceId: "ws-gen-1",
      stateBuffer: Buffer.from("snapshot-bytes"),
      uncompressedSize: 1234,
    })
    const sql = sqlTextOf(
      (prismaMock.$executeRaw as ReturnType<typeof vi.fn>).mock.calls[0] as RawCall,
    )
    // Trigger: stored snapshot contract differs from the deployed contract.
    expect(sql).toContain('"runtimeStateContract" <> "deployedRuntimeContract"')
    // Pin: outgoing snapshot lands in the preMigration slot for 7 days.
    expect(sql).toMatch(/"preMigrationSnapshot"\s+= CASE WHEN/)
    expect(sql).toContain("NOW() + interval '7 days'")
    // Occupied unexpired slot is never clobbered by a later flap.
    expect(sql).toContain('"preMigrationPinnedUntil" < NOW()')
    // New snapshot contract is stamped from the deploy stamp.
    expect(sql).toContain('COALESCE("deployedRuntimeContract", "runtimeStateContract")')
  })
})
