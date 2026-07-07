import { describe, it, expect, beforeEach, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { createMockRequest } from "@/test/helpers/mock-request"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

const mockGetSessionUser = vi.fn()
vi.mock("@/lib/api/auth", () => ({ getSessionUser: () => mockGetSessionUser() }))

const mockVerifyOwnership = vi.fn()
vi.mock("@/lib/api/ownership", () => ({
  verifyWorkspaceOwnership: (...args: unknown[]) => mockVerifyOwnership(...args),
}))

const mockBuildFingerprint = vi.fn()
vi.mock("@/lib/openclaw/config-fingerprint", () => ({
  CONFIG_FINGERPRINT_VERSION: 2,
  buildWorkspaceConfigFingerprint: (...args: unknown[]) => mockBuildFingerprint(...args),
}))

import { GET } from "@/app/api/deploy/[workspaceId]/status/route"

function callRoute(search = "") {
  const req = createMockRequest(`http://localhost:3000/api/deploy/ws-1/status${search}`)
  return GET(req, { params: Promise.resolve({ workspaceId: "ws-1" }) })
}

const currentFingerprint = {
  version: 2,
  hash: "current-hash",
  areas: {
    tools: "tools-v2",
    agents: "agents-v1",
    connections: "connections-v1",
    channels: "channels-v1",
    keys: "keys-v1",
    workspace: "workspace-v1",
  },
}

describe("GET /api/deploy/[workspaceId]/status", () => {
  beforeEach(() => {
    mockGetSessionUser.mockResolvedValue({ id: "user-1" })
    mockVerifyOwnership.mockResolvedValue({
      error: null,
      workspace: { id: "ws-1", apiKeySourceOverride: null, user: { apiKeySource: "USER_OWN_KEY" } },
    })
    ;(prismaMock.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ apiKeySource: "USER_OWN_KEY" })
    ;(prismaMock.deployment.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "dep-latest",
      status: "COMPLETED",
      version: 1,
      errorMessage: null,
      startedAt: new Date("2026-01-01T00:00:00Z"),
      completedAt: new Date("2026-01-01T00:01:00Z"),
      containerId: "svc-1",
      containerImage: "img:v1",
    })
    mockBuildFingerprint.mockResolvedValue(currentFingerprint)
  })

  it("does not compute drift unless ?drift=1 is present", async () => {
    const res = await callRoute()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.drift).toBeUndefined()
    expect(mockBuildFingerprint).not.toHaveBeenCalled()
    expect(prismaMock.deployment.findFirst).toHaveBeenCalledTimes(1)
  })

  it("returns stale drift with changed areas when current hash differs from latest completed deployment hash", async () => {
    ;(prismaMock.deployment.findFirst as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        id: "dep-latest",
        status: "COMPLETED",
        version: 2,
        errorMessage: null,
        startedAt: new Date("2026-01-02T00:00:00Z"),
        completedAt: new Date("2026-01-02T00:01:00Z"),
        containerId: "svc-1",
        containerImage: "img:v2",
      })
      .mockResolvedValueOnce({
        configHash: "deployed-hash",
        completedAt: new Date("2026-01-01T00:01:00Z"),
        configSnapshot: JSON.stringify({
          fingerprintVersion: 2,
          areas: {
            tools: "tools-v1",
            agents: "agents-v1",
            connections: "connections-v1",
            channels: "channels-v1",
            keys: "keys-v1",
            workspace: "workspace-v1",
          },
        }),
      })

    const res = await callRoute("?drift=1")
    const json = await res.json()

    expect(json.data.drift).toMatchObject({
      isStale: true,
      currentHash: "current-hash",
      deployedHash: "deployed-hash",
      changedAreas: ["tools"],
    })
  })

  it("returns fresh drift when current hash matches latest completed deployment hash", async () => {
    ;(prismaMock.deployment.findFirst as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        id: "dep-latest",
        status: "COMPLETED",
        version: 2,
        errorMessage: null,
        startedAt: new Date("2026-01-02T00:00:00Z"),
        completedAt: new Date("2026-01-02T00:01:00Z"),
        containerId: "svc-1",
        containerImage: "img:v2",
      })
      .mockResolvedValueOnce({
        configHash: "current-hash",
        completedAt: new Date("2026-01-01T00:01:00Z"),
        configSnapshot: JSON.stringify({ fingerprintVersion: 2, areas: currentFingerprint.areas }),
      })

    const res = await callRoute("?drift=1")
    const json = await res.json()

    expect(json.data.drift).toMatchObject({
      isStale: false,
      currentHash: "current-hash",
      deployedHash: "current-hash",
      changedAreas: [],
    })
  })

  it("treats legacy completed deployments with null configHash as unknown, not stale", async () => {
    ;(prismaMock.deployment.findFirst as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        id: "dep-latest",
        status: "COMPLETED",
        version: 2,
        errorMessage: null,
        startedAt: new Date("2026-01-02T00:00:00Z"),
        completedAt: new Date("2026-01-02T00:01:00Z"),
        containerId: "svc-1",
        containerImage: "img:v2",
      })
      .mockResolvedValueOnce({
        configHash: null,
        completedAt: new Date("2026-01-01T00:01:00Z"),
        configSnapshot: JSON.stringify({ workspaceId: "ws-1" }),
      })

    const res = await callRoute("?drift=1")
    const json = await res.json()

    expect(json.data.drift).toMatchObject({
      isStale: false,
      deployedHash: null,
      changedAreas: [],
    })
  })

  it("treats fingerprint-version mismatch as unknown, not stale", async () => {
    ;(prismaMock.deployment.findFirst as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        id: "dep-latest",
        status: "COMPLETED",
        version: 2,
        errorMessage: null,
        startedAt: new Date("2026-01-02T00:00:00Z"),
        completedAt: new Date("2026-01-02T00:01:00Z"),
        containerId: "svc-1",
        containerImage: "img:v2",
      })
      .mockResolvedValueOnce({
        configHash: "deployed-hash",
        completedAt: new Date("2026-01-01T00:01:00Z"),
        configSnapshot: JSON.stringify({
          fingerprintVersion: 1,
          areas: {
            tools: "tools-v1",
            agents: "agents-v1",
            connections: "connections-v1",
            channels: "channels-v1",
            keys: "keys-v1",
            workspace: "workspace-v1",
          },
        }),
      })

    const res = await callRoute("?drift=1")
    const json = await res.json()

    expect(json.data.drift).toMatchObject({
      isStale: false,
      currentHash: "current-hash",
      deployedHash: "deployed-hash",
      currentFingerprintVersion: 2,
      deployedFingerprintVersion: 1,
      changedAreas: [],
    })
  })
})
