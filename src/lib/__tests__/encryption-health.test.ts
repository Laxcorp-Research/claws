// @vitest-environment node
//
// The decrypt canary must SCREAM (structured log.error) when existing secrets
// can't be decrypted - so a key mismatch is obvious at deploy time instead of
// silently 500ing every secret op. A normal DB sampling error must NOT
// false-alarm (only a genuine decrypt failure does). Mutations: swallow the
// loud log -> loud-fail test fails; flip on DB error -> false-alarm test fails.

import { describe, it, expect, vi, beforeEach } from "vitest"

const { wsFindMany, uakFindMany } = vi.hoisted(() => ({
  wsFindMany: vi.fn(),
  uakFindMany: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: { workspace: { findMany: wsFindMany }, userApiKey: { findMany: uakFindMany } },
}))
vi.mock("@/lib/logger", () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

import { canaryAndLog, runDecryptCanary } from "@/lib/encryption-health"
import { encrypt } from "@/lib/encryption"
import { log } from "@/lib/logger"

// A deliberately-undecryptable blob (valid shape, garbage material).
const UNDECRYPTABLE =
  "v1:" +
  Buffer.alloc(16).toString("base64") +
  ":" +
  Buffer.alloc(16).toString("base64") +
  ":" +
  Buffer.from("garbage").toString("base64")

beforeEach(() => {
  vi.clearAllMocks()
  process.env.ENCRYPTION_MASTER_KEY = "a".repeat(64)
  delete process.env.ENCRYPTION_MASTER_KEY_PREVIOUS
})

describe("canaryAndLog", () => {
  it("passes silently when sample secrets decrypt (no loud log)", () => {
    const result = canaryAndLog([encrypt("alpha"), encrypt("beta")])
    expect(result.ok).toBe(true)
    expect(result.failed).toBe(0)
    expect(log.error).not.toHaveBeenCalled()
  })

  it("FAILS LOUDLY (log.error) when a secret can't be decrypted - key-mismatch alarm", () => {
    const result = canaryAndLog([encrypt("alpha"), UNDECRYPTABLE])
    expect(result.ok).toBe(false)
    expect(result.failed).toBe(1)
    expect(log.error).toHaveBeenCalledTimes(1)
    expect((log.error as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatch(/ENCRYPTION_MASTER_KEY cannot decrypt/i)
  })
})

describe("runDecryptCanary", () => {
  it("reports ok when sampled secrets all decrypt", async () => {
    wsFindMany.mockResolvedValue([{ gatewayToken: encrypt("gw") }])
    uakFindMany.mockResolvedValue([{ encryptedKey: encrypt("ak") }])
    const r = await runDecryptCanary()
    expect(r.ok).toBe(true)
    expect(r.checked).toBe(2)
    expect(log.error).not.toHaveBeenCalled()
  })

  it("reports NOT ok + loud log when a sampled secret can't be decrypted", async () => {
    wsFindMany.mockResolvedValue([{ gatewayToken: UNDECRYPTABLE }])
    uakFindMany.mockResolvedValue([])
    const r = await runDecryptCanary()
    expect(r.ok).toBe(false)
    expect(r.failed).toBe(1)
    expect(log.error).toHaveBeenCalledTimes(1)
  })

  it("does NOT false-alarm on a DB sampling error (ok, no loud log)", async () => {
    wsFindMany.mockRejectedValue(new Error("db down"))
    uakFindMany.mockResolvedValue([])
    const r = await runDecryptCanary()
    expect(r.ok).toBe(true) // MUTATION: flip canary on DB error -> this fails
    expect(r.checked).toBe(0)
    expect(log.error).not.toHaveBeenCalled() // the loud alarm must NOT fire on infra errors
    expect(log.warn).toHaveBeenCalledTimes(1) // sampling issue is a warn, not the alarm
  })

  it("reports ok (vacuously) when there are no secrets to sample", async () => {
    wsFindMany.mockResolvedValue([])
    uakFindMany.mockResolvedValue([])
    const r = await runDecryptCanary()
    expect(r.ok).toBe(true)
    expect(r.checked).toBe(0)
    expect(log.error).not.toHaveBeenCalled()
  })
})
