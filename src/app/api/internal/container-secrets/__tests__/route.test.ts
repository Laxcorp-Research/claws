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
  let prevAgentSecret: string | undefined
  let prevMeteringEndpoint: string | undefined
  let prevMeteringSecret: string | undefined
  let prevMasterAnthropic: string | undefined
  let prevTransportKey: string | undefined

  beforeEach(() => {
    prevAgentSecret = process.env.CONTAINER_AGENT_SECRET
    prevMeteringEndpoint = process.env.METERING_ENDPOINT
    prevMeteringSecret = process.env.METERING_MASTER_SECRET
    prevMasterAnthropic = process.env.CLAWS_MASTER_ANTHROPIC_KEY
    prevTransportKey = process.env.AGENT_TRANSPORT_KEY

    process.env.CONTAINER_AGENT_SECRET = AGENT_SECRET
    process.env.METERING_ENDPOINT = "https://staging-metering.test/api/internal/metering"
    process.env.METERING_MASTER_SECRET = "test_metering_secret_pr2"
    process.env.CLAWS_MASTER_ANTHROPIC_KEY = "sk-ant-test-master-pr2"
    // Disable transport-key path so the route returns plain envVars[] for assertion.
    delete process.env.AGENT_TRANSPORT_KEY
  })

  afterEach(() => {
    if (prevAgentSecret === undefined) delete process.env.CONTAINER_AGENT_SECRET
    else process.env.CONTAINER_AGENT_SECRET = prevAgentSecret
    if (prevMeteringEndpoint === undefined) delete process.env.METERING_ENDPOINT
    else process.env.METERING_ENDPOINT = prevMeteringEndpoint
    if (prevMeteringSecret === undefined) delete process.env.METERING_MASTER_SECRET
    else process.env.METERING_MASTER_SECRET = prevMeteringSecret
    if (prevMasterAnthropic === undefined) delete process.env.CLAWS_MASTER_ANTHROPIC_KEY
    else process.env.CLAWS_MASTER_ANTHROPIC_KEY = prevMasterAnthropic
    if (prevTransportKey === undefined) delete process.env.AGENT_TRANSPORT_KEY
    else process.env.AGENT_TRANSPORT_KEY = prevTransportKey
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

  it("falls back to default metering endpoint when METERING_ENDPOINT env is unset", async () => {
    delete process.env.METERING_ENDPOINT
    ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "ws-default",
      userId: "user-default",
      gatewayToken: null,
      channelConfigEncrypted: null,
      apiKeySourceOverride: null,
      user: { id: "user-default", apiKeySource: "NONE", apiKeys: [], creditAccount: null },
    })
    const res = await callRoute({ workspaceId: "ws-default" }, `Bearer ${AGENT_SECRET}`)
    expect(res.status).toBe(200)
    const body = await res.json()
    const env = parseEnvVars(body.data)
    expect(env.CLAWS_METERING_ENDPOINT).toBe("https://app.buildclaws.ai/api/internal/metering")
  })
})
