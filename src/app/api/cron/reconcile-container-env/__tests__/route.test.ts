// route.test.ts — PR-8a/C/A skeleton coverage for the env-reconciliation cron:
// auth, per-tick Redis lock (acquire / held / Redis-down), scope query +
// rotation stamping, summary shape, and ENV_RECONCILE_MODE handling.
//
// The route reads CRON_SECRET / ENV_RECONCILE_MODE at REQUEST time (inside GET),
// so a static import + vi.stubEnv per test is sufficient — no dynamic import.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import type { NextRequest } from "next/server"
import { prismaMock } from "@/test/helpers/mock-prisma"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

const mockRedisSet = vi.fn()
const mockRedisDel = vi.fn()
vi.mock("@/lib/redis", () => ({
  redis: {
    set: (...args: unknown[]) => mockRedisSet(...args),
    del: (...args: unknown[]) => mockRedisDel(...args),
  },
}))

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// Mock getServiceVariables (the Railway network read) but keep the REAL
// RailwayApiError class via importActual, so the route's `instanceof
// RailwayApiError` error classification works against errors we throw here.
const mockGetServiceVariables = vi.fn()
vi.mock("@/lib/openclaw/railway-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/openclaw/railway-client")>(
    "@/lib/openclaw/railway-client",
  )
  return { ...actual, getServiceVariables: (...args: unknown[]) => mockGetServiceVariables(...args) }
})

// deriveContainerEnv (real) decrypts BYOK keys — deterministic mock.
vi.mock("@/lib/encryption", () => ({
  encrypt: (v: string) => `enc:${v}`,
  decrypt: (v: string) => v.replace(/^enc:/, ""),
}))

// PR-8b/B: healWorkspace (the shared AUTO-HEAL core) is mocked here so these
// unit tests pin the cron's WIRING (gate + counters + log shapes); the helper's
// own cooldown/redeploy behavior is covered in heal-workspace.test.ts.
const mockHealWorkspace = vi.fn()
vi.mock("@/lib/openclaw/heal-workspace", () => ({
  healWorkspace: (...a: unknown[]) => mockHealWorkspace(...a),
}))

import { GET } from "@/app/api/cron/reconcile-container-env/route"
import { log } from "@/lib/logger"
import { RailwayApiError } from "@/lib/openclaw/railway-client"

const b64 = (envText: string) => Buffer.from(envText, "utf8").toString("base64")

function req(authHeader?: string): NextRequest {
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
  apiKeySourceOverride: string | null = null,
) {
  return {
    id,
    containerId: `svc-${id}`,
    status: "RUNNING",
    apiKeySourceOverride,
    user: { apiKeySource: user.apiKeySource, apiKeys: user.apiKeys ?? [] },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("CRON_SECRET", "test-cron-secret")
  vi.stubEnv("ENV_RECONCILE_MODE", "") // default → detect_only
  mockRedisSet.mockResolvedValue("OK") // lock acquired by default
  mockRedisDel.mockResolvedValue(1)
  mockGetServiceVariables.mockReset()
  // Default: non-credit, no key → matches a NONE workspace (no drift).
  mockGetServiceVariables.mockResolvedValue({ CLAWS_CREDIT_MODE: "false" })
  ;(prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([])
  ;(prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({})
  // Default "after" re-read (PR-8a/C/C): RUNNING + a deployment completed well
  // past the grace window → passes all transient-window exclusions so the
  // comparison runs. Per-case tests override this.
  ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
    status: "RUNNING",
    deployments: [{ completedAt: new Date(Date.now() - 120_000), status: "COMPLETED" }],
  })
  mockHealWorkspace.mockReset()
  mockHealWorkspace.mockResolvedValue({ ok: true, action: "healed" })
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("reconcile-container-env cron — PR-8a/C/A skeleton", () => {
  it("missing Bearer token → 401, no DB query, no Redis call", async () => {
    const res = await GET(req())
    expect(res.status).toBe(401)
    expect(prismaMock.workspace.findMany).not.toHaveBeenCalled()
    expect(mockRedisSet).not.toHaveBeenCalled()
  })

  it("wrong Bearer token → 401", async () => {
    const res = await GET(req("Bearer wrong-secret"))
    expect(res.status).toBe(401)
    expect(prismaMock.workspace.findMany).not.toHaveBeenCalled()
  })

  it("correct auth + zero workspaces → 200 with all-zero summary", async () => {
    const res = await GET(req("Bearer test-cron-secret"))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data.checked).toBe(0)
    expect(body.data.drifts).toBe(0)
    expect(body.data.mode).toBe("detect_only")
    // Lock acquired with NX + EX (mutation lock: removing the acquisition fails this).
    expect(mockRedisSet).toHaveBeenCalledWith("reconcile:env:tick", "1", { nx: true, ex: 65 })
    // Lock released on the happy path (mutation lock: removing the finally del fails this).
    expect(mockRedisDel).toHaveBeenCalledWith("reconcile:env:tick")
  })

  it("correct auth + 3 workspaces → checked=3 and lastEnvReconcileAt stamped for each", async () => {
    ;(prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      wsRow("ws-1"),
      wsRow("ws-2"),
      wsRow("ws-3"),
    ])
    const res = await GET(req("Bearer test-cron-secret"))
    const body = await res.json()
    expect(body.data.checked).toBe(3)
    expect(prismaMock.workspace.update).toHaveBeenCalledTimes(3)
    const calls = (prismaMock.workspace.update as ReturnType<typeof vi.fn>).mock.calls
    expect(calls.map((c) => c[0].where.id).sort()).toEqual(["ws-1", "ws-2", "ws-3"])
    for (const c of calls) {
      expect(c[0].data.lastEnvReconcileAt).toBeInstanceOf(Date)
    }
  })

  it("scope query targets RUNNING + containerId not null, oldest-first, capped at 20", async () => {
    await GET(req("Bearer test-cron-secret"))
    const args = (prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(args.where).toEqual({ status: "RUNNING", containerId: { not: null } })
    expect(args.orderBy).toEqual({ lastEnvReconcileAt: { sort: "asc", nulls: "first" } })
    expect(args.take).toBe(20)
    // user.apiKeys included so deriveContainerEnv (PR-8a/C/B) can derive expected.
    expect(args.select.user.select.apiKeys).toBeTruthy()
  })

  it("lock already held (NX returns null) → 200 skipped:locked, no DB query, no release", async () => {
    mockRedisSet.mockResolvedValue(null)
    const res = await GET(req("Bearer test-cron-secret"))
    const body = await res.json()
    expect(body.data.skipped).toBe("locked")
    expect(prismaMock.workspace.findMany).not.toHaveBeenCalled()
    expect(mockRedisDel).not.toHaveBeenCalled() // never acquired → never release
  })

  it("Redis unreachable on acquire → proceeds lock-less and still processes (detect-only idempotent)", async () => {
    mockRedisSet.mockRejectedValue(new Error("redis down"))
    ;(prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([wsRow("ws-1")])
    const res = await GET(req("Bearer test-cron-secret"))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(prismaMock.workspace.findMany).toHaveBeenCalled()
    expect(body.data.checked).toBe(1)
    expect(mockRedisDel).not.toHaveBeenCalled() // lock-less → nothing to release
    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining("lock acquisition failed"),
      expect.objectContaining({ event: "lock_error" }),
    )
  })

  // PR-8b/B: the PR-8a/C downgrade is GONE — auto_heal is real now.
  it('ENV_RECONCILE_MODE="auto_heal" → runs AUTO-HEAL, no downgrade warning', async () => {
    vi.stubEnv("ENV_RECONCILE_MODE", "auto_heal")
    const res = await GET(req("Bearer test-cron-secret"))
    const body = await res.json()
    expect(body.data.mode).toBe("auto_heal")
    expect(log.warn).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ event: "mode_downgraded" }),
    )
  })

  it("invalid ENV_RECONCILE_MODE → throws (fail-closed on misconfig)", async () => {
    vi.stubEnv("ENV_RECONCILE_MODE", "garbage")
    await expect(GET(req("Bearer test-cron-secret"))).rejects.toThrow(/Invalid ENV_RECONCILE_MODE/)
  })

  // PR-8b/B — AUTO-HEAL wiring into the drift branch. Drift is produced with a
  // PLATFORM_CREDIT workspace (expected credit_mode=true) vs the default actual
  // (credit_mode=false) → all three fields drift. healWorkspace is mocked.
  it("auto_heal + drift + cooldown free → healWorkspace called, summary.healed=1", async () => {
    vi.stubEnv("ENV_RECONCILE_MODE", "auto_heal")
    vi.stubEnv("CLAWS_MASTER_ANTHROPIC_KEY", "sk-ant-master")
    ;(prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      wsRow("ws-d", { apiKeySource: "PLATFORM_CREDIT" }),
    ])
    mockHealWorkspace.mockResolvedValue({ ok: true, action: "healed" })
    const body = await (await GET(req("Bearer test-cron-secret"))).json()
    expect(body.data.drifts).toBe(1)
    expect(mockHealWorkspace).toHaveBeenCalledWith("ws-d")
    expect(body.data.healed).toBe(1)
    expect(log.info).toHaveBeenCalledWith(
      "env reconciliation: workspace healed",
      expect.objectContaining({ event: "healed", workspaceId: "ws-d" }),
    )
  })

  it("auto_heal + drift + cooldown held → cooldown_skipped, summary.skipped.cooldown_active=1", async () => {
    vi.stubEnv("ENV_RECONCILE_MODE", "auto_heal")
    vi.stubEnv("CLAWS_MASTER_ANTHROPIC_KEY", "sk-ant-master")
    ;(prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      wsRow("ws-d", { apiKeySource: "PLATFORM_CREDIT" }),
    ])
    mockHealWorkspace.mockResolvedValue({ ok: true, action: "cooldown_skipped" })
    const body = await (await GET(req("Bearer test-cron-secret"))).json()
    expect(body.data.drifts).toBe(1)
    expect(body.data.healed).toBe(0)
    expect(body.data.skipped.cooldown_active).toBe(1)
  })

  it("auto_heal + drift + heal error → summary.errors.heal_error=1", async () => {
    vi.stubEnv("ENV_RECONCILE_MODE", "auto_heal")
    vi.stubEnv("CLAWS_MASTER_ANTHROPIC_KEY", "sk-ant-master")
    ;(prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      wsRow("ws-d", { apiKeySource: "PLATFORM_CREDIT" }),
    ])
    mockHealWorkspace.mockResolvedValue({ ok: false, error: "railway down" })
    const body = await (await GET(req("Bearer test-cron-secret"))).json()
    expect(body.data.drifts).toBe(1)
    expect(body.data.errors.heal_error).toBe(1)
    expect(log.error).toHaveBeenCalledWith(
      "env reconciliation: heal failed",
      expect.objectContaining({ event: "heal_error", workspaceId: "ws-d", error: "railway down" }),
    )
  })

  it("detect_only + drift → drift logged but healWorkspace NEVER called (PR-8a/C behavior preserved)", async () => {
    vi.stubEnv("ENV_RECONCILE_MODE", "detect_only")
    vi.stubEnv("CLAWS_MASTER_ANTHROPIC_KEY", "sk-ant-master")
    ;(prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      wsRow("ws-d", { apiKeySource: "PLATFORM_CREDIT" }),
    ])
    const body = await (await GET(req("Bearer test-cron-secret"))).json()
    expect(body.data.drifts).toBe(1)
    expect(mockHealWorkspace).not.toHaveBeenCalled()
    expect(body.data.healed).toBe(0)
  })
})

describe("reconcile-container-env cron — PR-8a/C/B per-workspace comparison", () => {
  const AUTH = "Bearer test-cron-secret"

  function driftCall() {
    return (log.warn as ReturnType<typeof vi.fn>).mock.calls.find((c) => c[0] === "env drift detected")
  }

  it("match (PLATFORM_CREDIT): expected == actual → no drift, checked=1", async () => {
    vi.stubEnv("CLAWS_MASTER_ANTHROPIC_KEY", "sk-ant-master")
    ;(prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      wsRow("ws-1", { apiKeySource: "PLATFORM_CREDIT" }),
    ])
    mockGetServiceVariables.mockResolvedValue({
      CLAWS_CREDIT_MODE: "true",
      ANTHROPIC_API_KEY: "sk-ant-master",
      ANTHROPIC_BASE_URL: "http://localhost:3789",
    })
    const body = await (await GET(req(AUTH))).json()
    expect(body.data.checked).toBe(1)
    expect(body.data.drifts).toBe(0)
    expect(driftCall()).toBeUndefined()
  })

  it("drift (credit_mode flip): PLATFORM_CREDIT in DB, container credit-mode=false but same key → driftFields=[credit_mode, base_url]", async () => {
    vi.stubEnv("CLAWS_MASTER_ANTHROPIC_KEY", "sk-ant-master")
    ;(prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      wsRow("ws-1", { apiKeySource: "PLATFORM_CREDIT" }),
    ])
    mockGetServiceVariables.mockResolvedValue({
      CLAWS_CREDIT_MODE: "false",
      CLAWS_ENV_B64: b64("ANTHROPIC_API_KEY=sk-ant-master\n"), // same key → key_fp matches
    })
    const body = await (await GET(req(AUTH))).json()
    expect(body.data.drifts).toBe(1)
    expect(driftCall()![1].driftFields).toEqual(["credit_mode", "base_url"])
  })

  it("drift (key_fp BYOK): DB key X vs container key Y → driftFields=[key_fp]", async () => {
    ;(prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      wsRow("ws-1", { apiKeySource: "USER_OWN_KEY", apiKeys: [{ provider: "ANTHROPIC", encryptedKey: "enc:key-X" }] }),
    ])
    mockGetServiceVariables.mockResolvedValue({
      CLAWS_CREDIT_MODE: "false",
      CLAWS_ENV_B64: b64("ANTHROPIC_API_KEY=key-Y\n"),
    })
    const body = await (await GET(req(AUTH))).json()
    expect(body.data.drifts).toBe(1)
    expect(driftCall()![1].driftFields).toEqual(["key_fp"])
  })

  it("drift (stale BYOK): DB key removed but container still has one → driftFields=[key_fp], expected.key_fp null", async () => {
    ;(prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      wsRow("ws-1", { apiKeySource: "USER_OWN_KEY", apiKeys: [] }), // no key in DB
    ])
    mockGetServiceVariables.mockResolvedValue({
      CLAWS_CREDIT_MODE: "false",
      CLAWS_ENV_B64: b64("ANTHROPIC_API_KEY=stale-old-key\n"),
    })
    const body = await (await GET(req(AUTH))).json()
    expect(body.data.drifts).toBe(1)
    const fields = driftCall()![1]
    expect(fields.driftFields).toEqual(["key_fp"])
    expect(fields.expected.key_fp).toBeNull()
    expect(typeof fields.actual.key_fp).toBe("string")
  })

  it("drift (multi): all three fields drift", async () => {
    vi.stubEnv("CLAWS_MASTER_ANTHROPIC_KEY", "sk-ant-master")
    ;(prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      wsRow("ws-1", { apiKeySource: "PLATFORM_CREDIT" }),
    ])
    mockGetServiceVariables.mockResolvedValue({
      CLAWS_CREDIT_MODE: "false",
      CLAWS_ENV_B64: b64("ANTHROPIC_API_KEY=totally-different-key\n"),
    })
    const body = await (await GET(req(AUTH))).json()
    expect(body.data.drifts).toBe(1)
    expect(driftCall()![1].driftFields).toEqual(["credit_mode", "base_url", "key_fp"])
  })

  it("match (NONE, no key on either side) → no drift", async () => {
    ;(prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([wsRow("ws-1")])
    mockGetServiceVariables.mockResolvedValue({ CLAWS_CREDIT_MODE: "false" })
    const body = await (await GET(req(AUTH))).json()
    expect(body.data.checked).toBe(1)
    expect(body.data.drifts).toBe(0)
  })

  it("passes the tight Railway budget { timeoutMs: 10_000, maxRetries: 1 } so a slow read can't blow the tick (CB-4 lock)", async () => {
    ;(prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([wsRow("ws-1")])
    await GET(req(AUTH))
    expect(mockGetServiceVariables).toHaveBeenCalledWith("svc-ws-1", { timeoutMs: 10_000, maxRetries: 1 })
  })

  // ── Error isolation: each Railway failure → correct errorKind, checked stays
  //    0, and the workspace is still rotated (lastEnvReconcileAt stamped). ──
  const errorCases: Array<[string, Error, string]> = [
    ["401", new RailwayApiError(401, "Railway API returned 401: nope"), "railway_auth"],
    ["404", new RailwayApiError(404, "Railway API returned 404: gone"), "railway_not_found"],
    ["429", new RailwayApiError(429, "Railway API returned 429: slow down"), "railway_rate_limited"],
    ["5xx", new RailwayApiError(503, "Railway API returned 503: oops"), "railway_5xx"],
    ["timeout", new RailwayApiError(0, "Railway API network error after 2 attempts: The operation timed out"), "railway_timeout"],
    ["network", new RailwayApiError(0, "Railway API network error after 2 attempts: fetch failed"), "railway_network"],
  ]
  for (const [label, err, kind] of errorCases) {
    it(`Railway ${label} → errorKind=${kind}, checked=0, workspace still rotated`, async () => {
      ;(prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([wsRow("ws-1")])
      mockGetServiceVariables.mockRejectedValue(err)
      const body = await (await GET(req(AUTH))).json()
      expect(body.data.errors[kind]).toBe(1)
      expect(body.data.checked).toBe(0)
      expect(body.data.drifts).toBe(0)
      expect(prismaMock.workspace.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "ws-1" } }),
      )
    })
  }

  it("multiple workspaces, one Railway error → others continue, counted independently, all rotated", async () => {
    ;(prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      wsRow("ws-1"),
      wsRow("ws-2"),
      wsRow("ws-3"),
    ])
    mockGetServiceVariables
      .mockRejectedValueOnce(new RailwayApiError(401, "Railway API returned 401: nope"))
      .mockResolvedValue({ CLAWS_CREDIT_MODE: "false" })
    const body = await (await GET(req(AUTH))).json()
    expect(body.data.errors.railway_auth).toBe(1)
    expect(body.data.checked).toBe(2) // ws-2 + ws-3 completed
    expect(prismaMock.workspace.update).toHaveBeenCalledTimes(3) // all 3 rotated
  })
})

describe("reconcile-container-env cron — PR-8a/C/C transient-window exclusions", () => {
  const AUTH = "Bearer test-cron-secret"
  const setFindUnique = (val: unknown) =>
    (prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(val)
  const skipLog = (reason: string) =>
    (log.info as ReturnType<typeof vi.fn>).mock.calls.find((c) => c[1]?.reason === reason)
  const driftLogged = () =>
    (log.warn as ReturnType<typeof vi.fn>).mock.calls.some((c) => c[0] === "env drift detected")

  it("status_changed_midwindow: re-read returns PAUSED → skip, no comparison, statusBefore/After logged", async () => {
    ;(prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([wsRow("ws-1")])
    setFindUnique({ status: "PAUSED", deployments: [{ completedAt: new Date(Date.now() - 120_000), status: "COMPLETED" }] })
    const body = await (await GET(req(AUTH))).json()
    expect(body.data.skipped.status_changed_midwindow).toBe(1)
    expect(body.data.checked).toBe(0)
    expect(body.data.drifts).toBe(0)
    expect(driftLogged()).toBe(false) // comparison never ran
    expect(skipLog("status_changed_midwindow")![1]).toMatchObject({ statusBefore: "RUNNING", statusAfter: "PAUSED" })
  })

  it("workspace_deleted_midwindow: re-read returns null → skip, NOT stamped (no row)", async () => {
    ;(prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([wsRow("ws-1")])
    setFindUnique(null)
    const body = await (await GET(req(AUTH))).json()
    expect(body.data.skipped.workspace_deleted_midwindow).toBe(1)
    expect(body.data.checked).toBe(0)
    expect(prismaMock.workspace.update).not.toHaveBeenCalled() // can't stamp a deleted row
  })

  it("deploy_in_progress: latest deployment completedAt=null → skip + deploymentStatus extra", async () => {
    ;(prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([wsRow("ws-1")])
    setFindUnique({ status: "RUNNING", deployments: [{ completedAt: null, status: "STARTING" }] })
    const body = await (await GET(req(AUTH))).json()
    expect(body.data.skipped.deploy_in_progress).toBe(1)
    expect(body.data.checked).toBe(0)
    expect(skipLog("deploy_in_progress")![1]).toMatchObject({ deploymentStatus: "STARTING" })
    expect(prismaMock.workspace.update).toHaveBeenCalledTimes(1) // still rotated
  })

  it("no_deployment_record: empty deployments[] → skip", async () => {
    ;(prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([wsRow("ws-1")])
    setFindUnique({ status: "RUNNING", deployments: [] })
    const body = await (await GET(req(AUTH))).json()
    expect(body.data.skipped.no_deployment_record).toBe(1)
    expect(body.data.checked).toBe(0)
    expect(prismaMock.workspace.update).toHaveBeenCalledTimes(1) // still rotated
  })

  it("recent_deploy: completed 30s ago → skip + msAgo≈30000", async () => {
    vi.useFakeTimers()
    const now = new Date("2026-06-03T12:00:00.000Z").getTime()
    vi.setSystemTime(now)
    ;(prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([wsRow("ws-1")])
    setFindUnique({ status: "RUNNING", deployments: [{ completedAt: new Date(now - 30_000), status: "COMPLETED" }] })
    const body = await (await GET(req(AUTH))).json()
    expect(body.data.skipped.recent_deploy).toBe(1)
    expect(body.data.checked).toBe(0)
    expect(skipLog("recent_deploy")![1].msAgo).toBe(30_000)
    vi.useRealTimers()
  })

  it("boundary: completed exactly 60s ago → PROCEEDS (strict < is the threshold)", async () => {
    vi.useFakeTimers()
    const now = new Date("2026-06-03T12:00:00.000Z").getTime()
    vi.setSystemTime(now)
    ;(prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([wsRow("ws-1")])
    setFindUnique({ status: "RUNNING", deployments: [{ completedAt: new Date(now - 60_000), status: "COMPLETED" }] })
    const body = await (await GET(req(AUTH))).json()
    expect(body.data.skipped.recent_deploy).toBe(0)
    expect(body.data.checked).toBe(1) // proceeded to comparison
    vi.useRealTimers()
  })

  it("boundary: completed 61s ago → proceeds to comparison normally", async () => {
    vi.useFakeTimers()
    const now = new Date("2026-06-03T12:00:00.000Z").getTime()
    vi.setSystemTime(now)
    ;(prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([wsRow("ws-1")])
    setFindUnique({ status: "RUNNING", deployments: [{ completedAt: new Date(now - 61_000), status: "COMPLETED" }] })
    const body = await (await GET(req(AUTH))).json()
    expect(body.data.skipped.recent_deploy).toBe(0)
    expect(body.data.checked).toBe(1)
    vi.useRealTimers()
  })

  it("second-read DB error → errorKind=db_read, checked=0, not stamped (retry next tick)", async () => {
    ;(prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([wsRow("ws-1")])
    ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("db down"))
    const body = await (await GET(req(AUTH))).json()
    expect(body.data.errors.db_read).toBe(1)
    expect(body.data.checked).toBe(0)
    expect(Object.values(body.data.skipped).every((v) => v === 0)).toBe(true) // not a skip
    expect(prismaMock.workspace.update).not.toHaveBeenCalled()
  })

  it("rotation: a skipped (non-deleted) workspace is still stamped", async () => {
    ;(prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([wsRow("ws-1")])
    setFindUnique({ status: "PAUSED", deployments: [{ completedAt: new Date(Date.now() - 120_000), status: "COMPLETED" }] })
    await GET(req(AUTH))
    expect(prismaMock.workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "ws-1" }, data: { lastEnvReconcileAt: expect.any(Date) } }),
    )
  })

  it("integration: 5 workspaces (match / drift / status_changed / recent_deploy / railway error) → correct summary, all rotated", async () => {
    ;(prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      wsRow("ws-1"), // NONE → match
      wsRow("ws-2", { apiKeySource: "USER_OWN_KEY", apiKeys: [{ provider: "ANTHROPIC", encryptedKey: "enc:key-X" }] }), // drift
      wsRow("ws-3"), // status_changed
      wsRow("ws-4"), // recent_deploy
      wsRow("ws-5"), // railway error
    ])
    mockGetServiceVariables.mockImplementation((cid: string) => {
      if (cid === "svc-ws-5") return Promise.reject(new RailwayApiError(503, "Railway API returned 503: x"))
      if (cid === "svc-ws-2") return Promise.resolve({ CLAWS_CREDIT_MODE: "false", CLAWS_ENV_B64: b64("ANTHROPIC_API_KEY=key-Y\n") })
      return Promise.resolve({ CLAWS_CREDIT_MODE: "false" })
    })
    ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockImplementation((args: { where: { id: string } }) => {
      if (args.where.id === "ws-3")
        return Promise.resolve({ status: "PAUSED", deployments: [{ completedAt: new Date(Date.now() - 120_000), status: "COMPLETED" }] })
      if (args.where.id === "ws-4")
        return Promise.resolve({ status: "RUNNING", deployments: [{ completedAt: new Date(Date.now() - 10_000), status: "COMPLETED" }] })
      return Promise.resolve({ status: "RUNNING", deployments: [{ completedAt: new Date(Date.now() - 120_000), status: "COMPLETED" }] })
    })

    const body = await (await GET(req(AUTH))).json()
    expect(body.data.checked).toBe(2) // ws-1 match + ws-2 drift
    expect(body.data.drifts).toBe(1) // ws-2
    expect(body.data.skipped.status_changed_midwindow).toBe(1) // ws-3
    expect(body.data.skipped.recent_deploy).toBe(1) // ws-4
    expect(body.data.errors.railway_5xx).toBe(1) // ws-5
    expect(prismaMock.workspace.update).toHaveBeenCalledTimes(5) // all rotated
  })
})
