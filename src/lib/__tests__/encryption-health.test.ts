// @vitest-environment node
//
// The decrypt canary must SCREAM (structured log.error) when existing secrets
// can't be decrypted — so a key mismatch is obvious at deploy time instead of
// silently 500ing every secret op. Mutation: swallow the failure → the loud-fail
// assertion fails.

import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/db", () => ({ prisma: {} }))
vi.mock("@/lib/logger", () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

import { canaryAndLog } from "@/lib/encryption-health"
import { encrypt } from "@/lib/encryption"
import { log } from "@/lib/logger"

// Build a deliberately-undecryptable blob (valid shape, wrong/garbage material).
const UNDECRYPTABLE =
  "v1:" +
  Buffer.alloc(16).toString("base64") +
  ":" +
  Buffer.alloc(16).toString("base64") +
  ":" +
  Buffer.from("garbage").toString("base64")

describe("encryption-health canary", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.ENCRYPTION_MASTER_KEY = "a".repeat(64)
    delete process.env.ENCRYPTION_MASTER_KEY_PREVIOUS
  })

  it("passes silently when sample secrets decrypt (no loud log)", () => {
    const good = [encrypt("alpha"), encrypt("beta")]
    const result = canaryAndLog(good)
    expect(result.ok).toBe(true)
    expect(result.failed).toBe(0)
    expect(log.error).not.toHaveBeenCalled()
  })

  it("FAILS LOUDLY (log.error) when a secret can't be decrypted — key-mismatch alarm", () => {
    const result = canaryAndLog([encrypt("alpha"), UNDECRYPTABLE])
    expect(result.ok).toBe(false)
    expect(result.failed).toBe(1)
    expect(log.error).toHaveBeenCalledTimes(1)
    // the alarm message names the cause so it's greppable in logs
    expect((log.error as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatch(/ENCRYPTION_MASTER_KEY cannot decrypt/i)
  })
})
