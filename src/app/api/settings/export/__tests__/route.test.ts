// Settings account-data export - the surface both ToS ("export your account
// data from Settings at any time") and the privacy policy promise.
// SECRET-FIELD LOCK: the export must NEVER contain credential material.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { prismaMock } from "@/test/helpers/mock-prisma"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

const mockGetSessionUser = vi.fn()
vi.mock("@/lib/api/auth", () => ({ getSessionUser: () => mockGetSessionUser() }))

import { GET } from "@/app/api/settings/export/route"

type MockFn = ReturnType<typeof vi.fn>

/** Credential columns that exist on the exported models - none may appear. */
const SECRET_FIELDS = [
  "encryptedKey",
  "encryptedCredentials",
  "gatewayToken",
  "channelConfigEncrypted",
  "chatDeviceKeyEncrypted",
  "payoutDetailsEncrypted",
  "hashedPassword",
]

beforeEach(() => {
  vi.clearAllMocks()
  mockGetSessionUser.mockResolvedValue({ id: "user-exp" })
  ;(prismaMock.user.findUniqueOrThrow as MockFn).mockResolvedValue({
    id: "user-exp",
    email: "exp@example.com",
    name: "Exporter",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    onboardingCompleted: true,
    hasActiveSubscription: true,
    subscriptionStatus: "active",
    trialUsed: true,
    trialStartedAt: null,
    trialEndsAt: null,
    apiKeySource: "PLATFORM_CREDIT",
    creditAccount: {
      initialGrantCents: 5000,
      balanceCents: 4200,
      totalConsumedCents: 800,
      status: "ACTIVE",
      grantedAt: new Date("2026-01-01T00:00:00Z"),
    },
  })
  ;(prismaMock.workspace.findMany as MockFn).mockResolvedValue([
    {
      id: "ws-1",
      name: "My Claw",
      slug: "my-claw",
      description: null,
      status: "RUNNING",
      provider: "RAILWAY",
      timezone: "UTC",
      deliveryMode: "APPROVAL_REQUIRED",
      maxRevisionRounds: 3,
      alwaysOn: false,
      canceledAt: null,
      stateRetainedUntil: null,
      createdAt: new Date("2026-02-01T00:00:00Z"),
      clawTemplate: { name: "Quant Trader", slug: "quant-trader" },
      agents: [
        {
          agentSlug: "orch",
          name: "Orchestrator",
          role: "ORCHESTRATOR",
          model: "anthropic/claude-sonnet-4-6",
          roleDescription: null,
          soulMd: "# Soul",
          agentsMd: "# Agents",
          heartbeatMd: null,
          userMd: null,
        },
      ],
      toolConnections: [
        {
          toolSlug: "binance",
          connectionType: "API_KEY",
          displayName: "Binance",
          status: "CONNECTED",
          createdAt: new Date("2026-02-02T00:00:00Z"),
        },
      ],
    },
  ])
  ;(prismaMock.purchase.findMany as MockFn).mockResolvedValue([
    {
      id: "purch-1",
      clawTemplate: { name: "Quant Trader", slug: "quant-trader" },
      amountPaid: 99,
      currency: "usd",
      status: "COMPLETED",
      createdAt: new Date("2026-02-01T00:00:00Z"),
    },
  ])
  ;(prismaMock.activityLog.findMany as MockFn).mockResolvedValue([
    {
      workspaceId: "ws-1",
      agentSlug: "orch",
      action: "Heartbeat check",
      actionType: "HEARTBEAT",
      timestamp: new Date("2026-03-01T00:00:00Z"),
    },
  ])
})

describe("GET /api/settings/export", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetSessionUser.mockResolvedValue(null)
    const res = await GET()
    expect(res.status).toBe(401)
  })

  it("downloads the user's account data as an attachment", async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect(res.headers.get("content-disposition")).toContain("attachment")
    expect(res.headers.get("content-disposition")).toContain("claws-account-export-")

    const body = JSON.parse(await res.text())
    expect(body.exportVersion).toBe(1)
    expect(body.user.email).toBe("exp@example.com")
    expect(body.workspaces[0].agents[0].soulMd).toBe("# Soul")
    expect(body.workspaces[0].toolConnections[0].toolSlug).toBe("binance")
    expect(body.purchases).toHaveLength(1)
    expect(body.activitySummary).toHaveLength(1)
  })

  it("SECRET LOCK: the serialized export contains no credential field names", async () => {
    const res = await GET()
    const text = await res.text()
    for (const field of SECRET_FIELDS) {
      expect(text, `export leaked ${field}`).not.toContain(field)
    }
  })

  it("MUTATION: the route source never selects credential columns", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/api/settings/export/route.ts"),
      "utf8",
    )
    for (const field of SECRET_FIELDS) {
      expect(src, `route selects ${field}`).not.toContain(`${field}: true`)
    }
    // Scoped to the requesting user only.
    expect(src).toContain("userId: sessionUser.id")
  })
})
