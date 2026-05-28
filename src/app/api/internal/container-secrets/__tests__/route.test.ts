// Tests for POST /api/internal/container-secrets.
//
// This route is the second emission path for container env vars (the first
// being deployer.ts's buildRailwayEnvVars). Whatever env-var distribution
// rules land in deployer.ts must also hold here — otherwise containers
// provisioned via the agent path drift from containers provisioned via the
// direct Railway path.
//
// PR2 introduces universal state-preservation env vars. These tests lock in
// the same rule for this route: CLAWS_WORKSPACE_ID, CLAWS_METERING_ENDPOINT,
// CLAWS_METERING_SECRET are emitted for every workspace regardless of
// apiKeySource. Credit-proxy-specific vars (ANTHROPIC_*, CLAWS_USER_ID)
// remain gated on PLATFORM_CREDIT.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { createMockRequest } from "@/test/helpers/mock-request"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// decrypt is only called for encrypted channel configs + user API keys.
// Tests here don't exercise those paths, so a passthrough mock is enough.
vi.mock("@/lib/encryption", () => ({
  decrypt: (s: string) => s,
}))

import { POST } from "@/app/api/internal/container-secrets/route"

const AGENT_SECRET = "test_agent_secret_pr2"

async function callRoute(body: Record<string, unknown>, authHeader?: string) {
  const req = createMockRequest("http://localhost:3000/api/internal/container-secrets", {
    method: "POST",
    headers: authHeader === undefined ? {} : { Authorization: authHeader },
    body,
  })
  return POST(req)
}

function parseEnvVars(data: { envVars?: string[] }): Record<string, string> {
  const map: Record<string, string> = {}
  for (const line of data.envVars ?? []) {
    const eq = line.indexOf("=")
    if (eq > 0) map[line.substring(0, eq)] = line.substring(eq + 1)
  }
  return map
}

describe("POST /api/internal/container-secrets", () => {
  let prev: Record<string, string | undefined>

  beforeEach(() => {
    prev = {
      CONTAINER_AGENT_SECRET: process.env.CONTAINER_AGENT_SECRET,
      METERING_ENDPOINT: process.env.METERING_ENDPOINT,
      METERING_MASTER_SECRET: process.env.METERING_MASTER_SECRET,
      ACTIVITY_ENDPOINT: process.env.ACTIVITY_ENDPOINT,
      ACTIVITY_PIPELINE_SECRET: process.env.ACTIVITY_PIPELINE_SECRET,
      NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
      CLAWS_MASTER_ANTHROPIC_KEY: process.env.CLAWS_MASTER_ANTHROPIC_KEY,
      AGENT_TRANSPORT_KEY: process.env.AGENT_TRANSPORT_KEY,
    }
    process.env.CONTAINER_AGENT_SECRET = AGENT_SECRET
    // PR-2b: all three required env vars set to a matching staging-shaped host
    // so the env-guards (require + host-match) pass in the happy path.
    process.env.NEXT_PUBLIC_APP_URL = "https://staging-metering.test"
    process.env.METERING_ENDPOINT = "https://staging-metering.test/api/internal/metering"
    process.env.METERING_MASTER_SECRET = "test_metering_secret_pr2"
    process.env.ACTIVITY_ENDPOINT = "https://staging-metering.test/api/internal/activity"
    process.env.ACTIVITY_PIPELINE_SECRET = "test_activity_secret_pr2b"
    process.env.CLAWS_MASTER_ANTHROPIC_KEY = "sk-ant-test-master-pr2"
    // Disable transport-key path so the route returns plain envVars[] for assertion.
    delete process.env.AGENT_TRANSPORT_KEY
  })

  afterEach(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  })

  it("returns 401 when Authorization header is missing", async () => {
    const res = await callRoute({ workspaceId: "ws-1" })
    expect(res.status).toBe(401)
  })

  it("returns 401 when Authorization header doesn't match CONTAINER_AGENT_SECRET", async () => {
    const res = await callRoute({ workspaceId: "ws-1" }, "Bearer wrong_secret")
    expect(res.status).toBe(401)
  })

  it("returns 404 when workspace doesn't exist", async () => {
    ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const res = await callRoute({ workspaceId: "ws-missing" }, `Bearer ${AGENT_SECRET}`)
    expect(res.status).toBe(404)
  })

  it("emits CLAWS_WORKSPACE_ID, CLAWS_METERING_ENDPOINT, CLAWS_METERING_SECRET for non-credit users (PR2)", async () => {
    ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "ws-noncredit",
      userId: "user-noncredit",
      gatewayToken: null,
      channelConfigEncrypted: null,
      apiKeySourceOverride: null,
      user: {
        id: "user-noncredit",
        apiKeySource: "USER_OWN_KEY",
        apiKeys: [],
        creditAccount: null,
      },
    })
    const res = await callRoute({ workspaceId: "ws-noncredit" }, `Bearer ${AGENT_SECRET}`)
    expect(res.status).toBe(200)
    const body = await res.json()
    const env = parseEnvVars(body.data)
    // State-sync triplet MUST be present (PR2 invariant).
    expect(env.CLAWS_WORKSPACE_ID).toBe("ws-noncredit")
    expect(env.CLAWS_METERING_ENDPOINT).toBe("https://staging-metering.test/api/internal/metering")
    expect(env.CLAWS_METERING_SECRET).toBe("test_metering_secret_pr2")
    // Credit-proxy vars must NOT be present.
    expect(env.CLAWS_USER_ID).toBeUndefined()
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined()
    // Explicit CLAWS_CREDIT_MODE=false for non-credit.
    expect(env.CLAWS_CREDIT_MODE).toBe("false")
  })

  it("emits state-sync triplet + credit-proxy vars for PLATFORM_CREDIT users", async () => {
    ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "ws-credit",
      userId: "user-credit",
      gatewayToken: null,
      channelConfigEncrypted: null,
      apiKeySourceOverride: null,
      user: {
        id: "user-credit",
        apiKeySource: "PLATFORM_CREDIT",
        apiKeys: [],
        creditAccount: { id: "ca-1" },
      },
    })
    const res = await callRoute({ workspaceId: "ws-credit" }, `Bearer ${AGENT_SECRET}`)
    expect(res.status).toBe(200)
    const body = await res.json()
    const env = parseEnvVars(body.data)
    // State-sync triplet (universal).
    expect(env.CLAWS_WORKSPACE_ID).toBe("ws-credit")
    expect(env.CLAWS_METERING_ENDPOINT).toBe("https://staging-metering.test/api/internal/metering")
    expect(env.CLAWS_METERING_SECRET).toBe("test_metering_secret_pr2")
    // Credit-proxy (credit-mode-only).
    expect(env.CLAWS_CREDIT_MODE).toBe("true")
    expect(env.CLAWS_USER_ID).toBe("user-credit")
    expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-test-master-pr2")
    expect(env.ANTHROPIC_BASE_URL).toBe("http://localhost:3789")
  })

  it("also emits CLAWS_ACTIVITY_ENDPOINT + CLAWS_ACTIVITY_SECRET (PR-2)", async () => {
    ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "ws-activity",
      userId: "user-activity",
      gatewayToken: null,
      channelConfigEncrypted: null,
      apiKeySourceOverride: null,
      user: { id: "user-activity", apiKeySource: "USER_OWN_KEY", apiKeys: [], creditAccount: null },
    })
    const res = await callRoute({ workspaceId: "ws-activity" }, `Bearer ${AGENT_SECRET}`)
    expect(res.status).toBe(200)
    const body = await res.json()
    const env = parseEnvVars(body.data)
    expect(env.CLAWS_ACTIVITY_ENDPOINT).toBe("https://staging-metering.test/api/internal/activity")
    expect(env.CLAWS_ACTIVITY_SECRET).toBe("test_activity_secret_pr2b")
  })

  // ─────────────────────────────────────────────────────────────────────
  // PR-2b #1 + #2: same guards as deployer.ts:buildRailwayEnvVars. The
  // container-secrets path is the SECOND emission point for these env
  // vars; it MUST enforce the same fail-closed + host-match invariants
  // or containers provisioned via the agent path will silently misroute.
  // ─────────────────────────────────────────────────────────────────────
  describe("PR-2b fail-closed + host-match guards", () => {
    const wsMock = {
      id: "ws-guard",
      userId: "user-guard",
      gatewayToken: null,
      channelConfigEncrypted: null,
      apiKeySourceOverride: null,
      user: { id: "user-guard", apiKeySource: "USER_OWN_KEY", apiKeys: [], creditAccount: null },
    }

    it("MUTATION-anchored: returns 500 ENDPOINT_CONFIG_INVALID when ACTIVITY_ENDPOINT unset (no silent prod fallback)", async () => {
      delete process.env.ACTIVITY_ENDPOINT
      ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(wsMock)
      const res = await callRoute({ workspaceId: "ws-guard" }, `Bearer ${AGENT_SECRET}`)
      expect(res.status).toBe(500)
      const body = await res.json()
      expect(body.error.code).toBe("ENDPOINT_CONFIG_INVALID")
      expect(body.error.message).toMatch(/ACTIVITY_ENDPOINT env var is required/)
    })

    it("returns 500 when METERING_ENDPOINT unset", async () => {
      delete process.env.METERING_ENDPOINT
      ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(wsMock)
      const res = await callRoute({ workspaceId: "ws-guard" }, `Bearer ${AGENT_SECRET}`)
      expect(res.status).toBe(500)
      const body = await res.json()
      expect(body.error.message).toMatch(/METERING_ENDPOINT env var is required/)
    })

    it("returns 500 on host mismatch — ACTIVITY_ENDPOINT host != NEXT_PUBLIC_APP_URL host", async () => {
      process.env.ACTIVITY_ENDPOINT = "https://app.buildclaws.ai/api/internal/activity" // prod
      // METERING already matches staging host from beforeEach
      ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(wsMock)
      const res = await callRoute({ workspaceId: "ws-guard" }, `Bearer ${AGENT_SECRET}`)
      expect(res.status).toBe(500)
      const body = await res.json()
      expect(body.error.message).toMatch(/Host mismatch refusing deploy.*ACTIVITY_ENDPOINT/)
    })

    it("returns 500 on host mismatch — METERING_ENDPOINT host != NEXT_PUBLIC_APP_URL host", async () => {
      process.env.METERING_ENDPOINT = "https://app.buildclaws.ai/api/internal/metering" // prod
      ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(wsMock)
      const res = await callRoute({ workspaceId: "ws-guard" }, `Bearer ${AGENT_SECRET}`)
      expect(res.status).toBe(500)
      const body = await res.json()
      expect(body.error.message).toMatch(/Host mismatch refusing deploy.*METERING_ENDPOINT/)
    })

    it("guards run BEFORE the workspace lookup (so a missing workspace can't mask a misconfigured env)", async () => {
      delete process.env.ACTIVITY_ENDPOINT
      ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null)
      const res = await callRoute({ workspaceId: "ws-nonexistent" }, `Bearer ${AGENT_SECRET}`)
      // Should be 500 from the guard, NOT 404 from workspace.findUnique returning null.
      expect(res.status).toBe(500)
      // prisma.workspace.findUnique should not even have been called.
      expect(prismaMock.workspace.findUnique).not.toHaveBeenCalled()
    })
  })
})
