import { beforeEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { createMockRequest } from "@/test/helpers/mock-request"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

const mockGetSessionUser = vi.fn()
vi.mock("@/lib/api/auth", () => ({ getSessionUser: () => mockGetSessionUser() }))

const mockVerifyOwnership = vi.fn()
vi.mock("@/lib/api/ownership", () => ({
  verifyWorkspaceOwnership: (...args: unknown[]) => mockVerifyOwnership(...args),
}))

vi.mock("@/lib/encryption", () => ({
  decrypt: (blob: string) => blob.replace(/^enc:/, ""),
}))

import { GET } from "@/app/api/channels/[workspaceId]/status/route"

const channelBlob = `enc:${JSON.stringify({
  telegram: { botToken: "telegram-token" },
  discord: { token: "discord-token" },
})}`

function req() {
  return createMockRequest("http://localhost:3000/api/channels/ws-1/status")
}

function workspace(overrides: Record<string, unknown> = {}) {
  return {
    id: "ws-1",
    status: "RUNNING",
    containerId: "svc-1",
    containerHost: "claw-ws-1.up.railway.app",
    gatewayToken: "enc:gateway-token",
    channelConfigEncrypted: channelBlob,
    ...overrides,
  }
}

async function callRoute() {
  return GET(req(), { params: Promise.resolve({ workspaceId: "ws-1" }) })
}

describe("GET /api/channels/[workspaceId]/status", () => {
  beforeEach(() => {
    mockGetSessionUser.mockResolvedValue({ id: "user-1" })
    mockVerifyOwnership.mockResolvedValue({ error: null, workspace: { id: "ws-1" } })
    ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(workspace())
    vi.stubGlobal("fetch", vi.fn())
  })

  it("returns 401 when unauthenticated", async () => {
    mockGetSessionUser.mockResolvedValue(null)

    const res = await callRoute()

    expect(res.status).toBe(401)
    expect(prismaMock.workspace.findUnique).not.toHaveBeenCalled()
  })

  it("returns configured truth with unknown live state when not deployed", async () => {
    ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      workspace({ status: "DRAFT", containerId: null, containerHost: null, gatewayToken: null }),
    )

    const res = await callRoute()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(fetch).not.toHaveBeenCalled()
    expect(json.data.channels.telegram).toEqual({ configured: true, live: "unknown" })
    expect(json.data.channels.discord).toEqual({ configured: true, live: "unknown" })
    expect(json.data.channels.slack).toEqual({ configured: false, live: "unknown" })
  })

  it("gateway down returns unknown, never fabricated connected", async () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network down"))

    const res = await callRoute()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.channels.telegram).toEqual({ configured: true, live: "unknown" })
    expect(json.data.channels.discord).toEqual({ configured: true, live: "unknown" })
  })

  it("maps gateway channels.status payload into connected and error states", async () => {
    ;(fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(JSON.stringify({
        ok: true,
        payload: {
          channels: {
            telegram: { configured: true, running: true, connected: true },
            discord: { configured: true, lastError: "invalid token" },
          },
        },
      })),
    )

    const res = await callRoute()
    const json = await res.json()

    expect(fetch).toHaveBeenCalledWith(
      "https://claw-ws-1.up.railway.app/api/v1/admin/rpc",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer gateway-token" }),
        body: JSON.stringify({ method: "channels.status", params: { probe: true, timeoutMs: 2500 } }),
      }),
    )
    expect(json.data.channels.telegram).toEqual({ configured: true, live: "connected" })
    expect(json.data.channels.discord).toEqual({ configured: true, live: "error", detail: "invalid token" })
  })
})
