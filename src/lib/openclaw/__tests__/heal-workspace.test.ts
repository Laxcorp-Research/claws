// Tests for the shared AUTO-HEAL core (PR-8b/A). Mode is driven via the real
// resolveMode reading ENV_RECONCILE_MODE (vi.stubEnv); Redis + redeployWorkspace
// are mocked at the I/O boundary.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const mockRedisSet = vi.fn()
const mockRedisDel = vi.fn()
vi.mock("@/lib/redis", () => ({
  redis: { set: (...a: unknown[]) => mockRedisSet(...a), del: (...a: unknown[]) => mockRedisDel(...a) },
}))

const mockRedeploy = vi.fn()
vi.mock("@/lib/openclaw/deployer", () => ({
  redeployWorkspace: (...a: unknown[]) => mockRedeploy(...a),
}))

vi.mock("@/lib/logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const mockLedger = vi.fn()
vi.mock("@/lib/healing/ledger", () => ({
  ledgerHealAttempt: (...a: unknown[]) => mockLedger(...a),
}))

import { healWorkspace, RECONCILE_COOLDOWN_SEC } from "@/lib/openclaw/heal-workspace"

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("ENV_RECONCILE_MODE", "auto_heal") // detect_only test overrides
  mockRedisSet.mockResolvedValue("OK") // cooldown free by default
  mockRedisDel.mockResolvedValue(1)
  mockRedeploy.mockResolvedValue(undefined)
})

afterEach(() => vi.unstubAllEnvs())

describe("healWorkspace", () => {
  it("detect_only → detect_only_noop; no Redis, no redeploy (the shared gate)", async () => {
    vi.stubEnv("ENV_RECONCILE_MODE", "detect_only")
    const r = await healWorkspace("ws-1")
    expect(r).toEqual({ ok: true, action: "detect_only_noop" })
    expect(mockRedisSet).not.toHaveBeenCalled()
    expect(mockRedeploy).not.toHaveBeenCalled()
  })

  it("auto_heal + cooldown free → acquires NX lock with TTL, redeploys, returns healed", async () => {
    const r = await healWorkspace("ws-1")
    expect(r).toEqual({ ok: true, action: "healed" })
    expect(mockRedisSet).toHaveBeenCalledWith("reconcile:cooldown:ws-1", "1", {
      nx: true,
      ex: RECONCILE_COOLDOWN_SEC,
    })
    expect(RECONCILE_COOLDOWN_SEC).toBe(1800)
    expect(mockRedeploy).toHaveBeenCalledWith("ws-1")
    expect(mockRedisDel).not.toHaveBeenCalled()
    expect(mockLedger).toHaveBeenCalledWith(
      expect.objectContaining({ condition: "env-credential-drift", outcome: "healed" }),
    )
  })

  it("auto_heal + cooldown held (NX returns null) → cooldown_skipped, no redeploy", async () => {
    mockRedisSet.mockResolvedValue(null)
    const r = await healWorkspace("ws-1")
    expect(r).toEqual({ ok: true, action: "cooldown_skipped" })
    expect(mockRedeploy).not.toHaveBeenCalled()
    expect(mockRedisDel).not.toHaveBeenCalled()
  })

  it("auto_heal + redeploy throws → releases cooldown (DEL) so next tick retries; returns error", async () => {
    mockRedeploy.mockRejectedValue(new Error("railway boom"))
    const r = await healWorkspace("ws-1")
    expect(r).toEqual({ ok: false, error: "railway boom" })
    expect(mockRedisDel).toHaveBeenCalledWith("reconcile:cooldown:ws-1")
  })

  it("auto_heal + Redis down on acquire → no redeploy, returns error (no lock ⇒ no heal)", async () => {
    mockRedisSet.mockRejectedValue(new Error("redis down"))
    const r = await healWorkspace("ws-1")
    expect(r).toEqual({ ok: false, error: "redis down" })
    expect(mockRedeploy).not.toHaveBeenCalled()
  })

  it("NX semantics: first call heals, second (lock held) skips - redeploy once", async () => {
    mockRedisSet.mockResolvedValueOnce("OK").mockResolvedValueOnce(null)
    const r1 = await healWorkspace("ws-9")
    const r2 = await healWorkspace("ws-9")
    expect(r1).toEqual({ ok: true, action: "healed" })
    expect(r2).toEqual({ ok: true, action: "cooldown_skipped" })
    expect(mockRedeploy).toHaveBeenCalledTimes(1)
  })
})
