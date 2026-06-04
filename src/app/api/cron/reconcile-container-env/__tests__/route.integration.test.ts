// route.integration.test.ts — PR-8a/C/D full-route integration of the
// env-reconciliation cron. Exercises the REAL route handler + real comparison,
// exclusion, logging, and summary logic, with only the I/O boundaries mocked
// (Redis lock, Railway read, Prisma, encryption). Each scenario is one test
// asserting the end-to-end outcome the way the live cron would behave.
//
// Kept separate from route.test.ts (unit) to isolate concerns: unit tests pin
// individual branches; these prove the whole tick composes correctly.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { NextRequest } from "next/server"
import { prismaMock } from "@/test/helpers/mock-prisma"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

const mockRedisSet = vi.fn()
const mockRedisDel = vi.fn()
vi.mock("@/lib/redis", () => ({
  redis: { set: (...a: unknown[]) => mockRedisSet(...a), del: (...a: unknown[]) => mockRedisDel(...a) },
}))

vi.mock("@/lib/logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

const mockGetServiceVariables = vi.fn()
vi.mock("@/lib/openclaw/railway-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/openclaw/railway-client")>(
    "@/lib/openclaw/railway-client",
  )
  return { ...actual, getServiceVariables: (...a: unknown[]) => mockGetServiceVariables(...a) }
})

vi.mock("@/lib/encryption", () => ({
  encrypt: (v: string) => `enc:${v}`,
  decrypt: (v: string) => v.replace(/^enc:/, ""),
}))

// Forward-guard: PR-8a is DETECT-ONLY and must NEVER call redeployWorkspace
// (the AUTO-HEAL action lands in PR-8b). The cron doesn't import deployer today;
// this mock is registered so that if a future change wires a heal in, Scenario E
// catches it.
const mockRedeployWorkspace = vi.fn()
vi.mock("@/lib/openclaw/deployer", () => ({
  redeployWorkspace: (...a: unknown[]) => mockRedeployWorkspace(...a),
}))

import { GET } from "@/app/api/cron/reconcile-container-env/route"
import { log } from "@/lib/logger"
import { RailwayApiError } from "@/lib/openclaw/railway-client"

const AUTH = "Bearer test-cron-secret"
const b64 = (envText: string) => Buffer.from(envText, "utf8").toString("base64")

function req(authHeader: string | undefined = AUTH): NextRequest {
  const headers = new Headers()
  if (authHeader) headers.set("authorization", authHeader)
  return new Request("https://app.test/api/cron/reconcile-container-env", { headers }) as unknown as NextRequest
}

function wsRow(
  id: string,
  user: { apiKeySource: string; apiKeys?: Array<{ provider: string; encryptedKey: string }> } = {
    apiKeySource: "NONE",
    apiKeys: [],
  },
) {
  return {
    id,
    containerId: `svc-${id}`,
    status: "RUNNING",
    apiKeySourceOverride: null,
    user: { apiKeySource: user.apiKeySource, apiKeys: user.apiKeys ?? [] },
  }
}

const pastGraceDeploy = () => ({ status: "RUNNING", deployments: [{ completedAt: new Date(Date.now() - 120_000), status: "COMPLETED" }] })
const driftLogs = () => (log.warn as ReturnType<typeof vi.fn>).mock.calls.filter((c) => c[0] === "env drift detected")
const skipLogs = () => (log.info as ReturnType<typeof vi.fn>).mock.calls.filter((c) => c[1]?.event === "drift_skipped_transient")

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("CRON_SECRET", "test-cron-secret")
  vi.stubEnv("ENV_RECONCILE_MODE", "")
  mockRedisSet.mockResolvedValue("OK")
  mockRedisDel.mockResolvedValue(1)
  mockGetServiceVariables.mockReset()
  mockGetServiceVariables.mockResolvedValue({ CLAWS_CREDIT_MODE: "false" })
  // PR-8b/B: integration runs the REAL healWorkspace; only the redeploy I/O is
  // mocked. Default to a successful trigger; per-scenario tests override.
  mockRedeployWorkspace.mockReset()
  mockRedeployWorkspace.mockResolvedValue(undefined)
  ;(prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([])
  ;(prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({})
  ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(pastGraceDeploy())
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("reconcile-container-env cron — PR-8a/C/D full-route integration", () => {
  it("Scenario A — happy path: 2 match, 2 drift, 1 Railway 401", async () => {
    vi.stubEnv("CLAWS_MASTER_ANTHROPIC_KEY", "sk-ant-master")
    ;(prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      wsRow("a1"),
      wsRow("a2"),
      wsRow("a3", { apiKeySource: "USER_OWN_KEY", apiKeys: [{ provider: "ANTHROPIC", encryptedKey: "enc:key-X" }] }),
      wsRow("a4", { apiKeySource: "PLATFORM_CREDIT" }),
      wsRow("a5"),
    ])
    mockGetServiceVariables.mockImplementation((cid: string) => {
      if (cid === "svc-a5") return Promise.reject(new RailwayApiError(401, "Railway API returned 401: x"))
      if (cid === "svc-a3") return Promise.resolve({ CLAWS_CREDIT_MODE: "false", CLAWS_ENV_B64: b64("ANTHROPIC_API_KEY=key-Y\n") })
      if (cid === "svc-a4") return Promise.resolve({ CLAWS_CREDIT_MODE: "false", CLAWS_ENV_B64: b64("ANTHROPIC_API_KEY=wrong-key\n") })
      return Promise.resolve({ CLAWS_CREDIT_MODE: "false" }) // a1, a2 match (NONE)
    })

    const body = await (await GET(req())).json()

    expect(body.data.checked).toBe(4) // a1, a2, a3, a4 completed comparison
    expect(body.data.drifts).toBe(2) // a3 (key_fp), a4 (triple)
    expect(body.data.errors.railway_auth).toBe(1) // a5
    expect(driftLogs()).toHaveLength(2)
    // errored workspace (a5) is still rotated
    expect(prismaMock.workspace.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "a5" } }))
    // lock acquired + released exactly once
    expect(mockRedisSet).toHaveBeenCalledTimes(1)
    expect(mockRedisDel).toHaveBeenCalledTimes(1)
    // CD-2 guard: a per-workspace second read happened for each non-errored ws
    expect(prismaMock.workspace.findUnique).toHaveBeenCalledTimes(4)
    expect(log.info).toHaveBeenCalledWith("env reconciliation complete", expect.objectContaining({ event: "run_complete" }))
  })

  it("Scenario B — all-skipped tick: one of each transient reason", async () => {
    ;(prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      wsRow("b1"),
      wsRow("b2"),
      wsRow("b3"),
      wsRow("b4"),
      wsRow("b5"),
    ])
    ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockImplementation((args: { where: { id: string } }) => {
      switch (args.where.id) {
        case "b1":
          return Promise.resolve({ status: "PAUSED", deployments: [{ completedAt: new Date(Date.now() - 120_000), status: "COMPLETED" }] })
        case "b2":
          return Promise.resolve({ status: "RUNNING", deployments: [{ completedAt: null, status: "STARTING" }] })
        case "b3":
          return Promise.resolve({ status: "RUNNING", deployments: [{ completedAt: new Date(Date.now() - 20_000), status: "COMPLETED" }] })
        case "b4":
          return Promise.resolve({ status: "RUNNING", deployments: [] })
        case "b5":
          return Promise.resolve(null)
        default:
          return Promise.resolve(pastGraceDeploy())
      }
    })

    const body = await (await GET(req())).json()

    expect(body.data.checked).toBe(0)
    expect(body.data.drifts).toBe(0)
    expect(body.data.skipped.status_changed_midwindow).toBe(1)
    expect(body.data.skipped.deploy_in_progress).toBe(1)
    expect(body.data.skipped.recent_deploy).toBe(1)
    expect(body.data.skipped.no_deployment_record).toBe(1)
    expect(body.data.skipped.workspace_deleted_midwindow).toBe(1)
    expect(skipLogs()).toHaveLength(5)
    expect(driftLogs()).toHaveLength(0)
    // b1–b4 rotated; b5 (deleted) not stamped
    expect(prismaMock.workspace.update).toHaveBeenCalledTimes(4)
    // CD-2 guard: second read per workspace
    expect(prismaMock.workspace.findUnique).toHaveBeenCalledTimes(5)
  })

  it("Scenario C — lock contention: NX returns null → skip, no workspace work", async () => {
    mockRedisSet.mockResolvedValue(null)
    const res = await GET(req())
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.data.skipped).toBe("locked")
    expect(prismaMock.workspace.findMany).not.toHaveBeenCalled()
    expect(mockGetServiceVariables).not.toHaveBeenCalled()
    expect(mockRedisDel).not.toHaveBeenCalled()
    expect(log.info).toHaveBeenCalledWith(
      "env reconciliation tick skipped (lock held)",
      expect.objectContaining({ event: "tick_skipped_locked" }),
    )
  })

  it("Scenario D — empty environment: zero workspaces", async () => {
    ;(prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([])
    const body = await (await GET(req())).json()
    expect(body.data.checked).toBe(0)
    expect(body.data.drifts).toBe(0)
    expect(mockGetServiceVariables).not.toHaveBeenCalled()
    expect(mockRedisSet).toHaveBeenCalledTimes(1)
    expect(mockRedisDel).toHaveBeenCalledTimes(1)
    expect(log.info).toHaveBeenCalledWith(
      "env reconciliation complete",
      expect.objectContaining({ event: "run_complete", checked: 0 }),
    )
  })

  it("Scenario E — ENV_RECONCILE_MODE=auto_heal HEALS the drifted workspace (downgrade gone)", async () => {
    vi.stubEnv("ENV_RECONCILE_MODE", "auto_heal")
    vi.stubEnv("CLAWS_MASTER_ANTHROPIC_KEY", "sk-ant-master")
    ;(prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      wsRow("e1"),
      wsRow("e2", { apiKeySource: "USER_OWN_KEY", apiKeys: [{ provider: "ANTHROPIC", encryptedKey: "enc:key-X" }] }),
      wsRow("e3"),
    ])
    mockGetServiceVariables.mockImplementation((cid: string) => {
      if (cid === "svc-e2") return Promise.resolve({ CLAWS_CREDIT_MODE: "false", CLAWS_ENV_B64: b64("ANTHROPIC_API_KEY=key-Y\n") })
      return Promise.resolve({ CLAWS_CREDIT_MODE: "false" })
    })

    const body = await (await GET(req())).json()

    expect(body.data.mode).toBe("auto_heal")
    // The PR-8a/C downgrade is gone — no mode_downgraded warning.
    expect(log.warn).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ event: "mode_downgraded" }),
    )
    // e2 drifts (key_fp) and is healed via the REAL healWorkspace → redeployWorkspace.
    expect(body.data.drifts).toBe(1) // e2
    expect(body.data.healed).toBe(1)
    expect(driftLogs()).toHaveLength(1)
    expect(mockRedeployWorkspace).toHaveBeenCalledTimes(1)
    expect(mockRedeployWorkspace).toHaveBeenCalledWith("e2")
  })

  it("Scenario F — AUTO-HEAL + cooldown chain: 3 drift, 2 cooldown-held → healed=1, cooldown_active=2", async () => {
    vi.stubEnv("ENV_RECONCILE_MODE", "auto_heal")
    vi.stubEnv("CLAWS_MASTER_ANTHROPIC_KEY", "sk-ant-master")
    ;(prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      wsRow("f1", { apiKeySource: "PLATFORM_CREDIT" }),
      wsRow("f2", { apiKeySource: "PLATFORM_CREDIT" }),
      wsRow("f3", { apiKeySource: "PLATFORM_CREDIT" }),
      wsRow("f4"),
      wsRow("f5"),
    ])
    // f1/f2/f3 drift (expected credit_mode=true vs actual false); f4/f5 match.
    // Per-key Redis: tick lock OK; f1 cooldown free; f2/f3 cooldown held.
    mockRedisSet.mockImplementation((key: string) => {
      if (key === "reconcile:env:tick") return Promise.resolve("OK")
      if (key === "reconcile:cooldown:f1") return Promise.resolve("OK")
      return Promise.resolve(null)
    })

    const body = await (await GET(req())).json()

    expect(body.data.drifts).toBe(3)
    expect(body.data.healed).toBe(1)
    expect(body.data.skipped.cooldown_active).toBe(2)
    expect(mockRedeployWorkspace).toHaveBeenCalledTimes(1)
    expect(mockRedeployWorkspace).toHaveBeenCalledWith("f1")
  })

  it("Scenario G — AUTO-HEAL + heal error isolation: 3 drift, one redeploy throws → healed=2, heal_error=1", async () => {
    vi.stubEnv("ENV_RECONCILE_MODE", "auto_heal")
    vi.stubEnv("CLAWS_MASTER_ANTHROPIC_KEY", "sk-ant-master")
    ;(prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      wsRow("g1", { apiKeySource: "PLATFORM_CREDIT" }),
      wsRow("g2", { apiKeySource: "PLATFORM_CREDIT" }),
      wsRow("g3", { apiKeySource: "PLATFORM_CREDIT" }),
    ])
    mockRedeployWorkspace.mockImplementation((id: string) =>
      id === "g2" ? Promise.reject(new Error("railway boom")) : Promise.resolve(undefined),
    )

    const body = await (await GET(req())).json()

    expect(body.data.drifts).toBe(3)
    expect(body.data.healed).toBe(2)
    expect(body.data.errors.heal_error).toBe(1)
    // g2's failed heal released its cooldown so a later tick can retry.
    expect(mockRedisDel).toHaveBeenCalledWith("reconcile:cooldown:g2")
    expect(mockRedeployWorkspace).toHaveBeenCalledTimes(3)
  })
})
