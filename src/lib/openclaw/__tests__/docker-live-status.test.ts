import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

import {
  __setDashboardUpgradeProbeForTests,
  __setDockerInspectForTests,
  readSelfHostDashboardStatus,
} from "@/lib/openclaw/docker-live-status"

beforeEach(() => {
  __setDockerInspectForTests(null)
  process.env.CLAWS_PROFILE = "self-host"
})

afterEach(() => {
  __setDockerInspectForTests(null)
  __setDashboardUpgradeProbeForTests(null)
  delete process.env.CLAWS_PROFILE
})

describe("self-host dashboard status", () => {
  it("mock docker inspect exited → ERROR with the deployment log, not Running", async () => {
    __setDockerInspectForTests({
      inspect: vi.fn().mockResolvedValue({ running: false, exitCode: 1, publishedPort: null }),
    })
    ;(prismaMock.deployment.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      errorMessage: "Gateway failed to start: Invalid config at openclaw.json.",
    })
    ;(prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({})

    const live = await readSelfHostDashboardStatus({
      id: "ws-1",
      status: "RUNNING",
      provider: "DOCKER",
      containerId: "ctr-dead",
    })

    expect(live.status).toBe("ERROR")
    expect(live.errorMessage).toContain("Invalid config")
    expect(prismaMock.workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "ERROR" }),
      }),
    )
  })

  it("mock docker inspect running but the upgrade is rejected → UNHEALTHY with the gateway line, not Running-healthy", async () => {
    __setDockerInspectForTests({
      inspect: vi.fn().mockResolvedValue({ running: true, exitCode: null, publishedPort: 32768 }),
    })
    __setDashboardUpgradeProbeForTests(async () => ({
      ok: false,
      status: 403,
      body: '{"error":{"message":"Proxy client attribution is required. Configure gateway.trustedProxies narrowly.","type":"proxy_attribution_required"}}',
    }))
    ;(prismaMock.deployment.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "dep-1" })
    ;(prismaMock.deployment.update as ReturnType<typeof vi.fn>).mockResolvedValue({})
    ;(prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({})

    const live = await readSelfHostDashboardStatus({
      id: "ws-1",
      status: "RUNNING",
      provider: "DOCKER",
      containerId: "ctr-up",
      containerHost: "claws-ws-1:18789",
      healthStatus: "HEALTHY",
    })

    expect(live.status).toBe("RUNNING")
    expect(live.healthStatus).toBe("UNHEALTHY")
    expect(live.errorMessage).toContain("Proxy client attribution is required")
    expect(prismaMock.workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ healthStatus: "UNHEALTHY", status: "RUNNING" }),
      }),
    )
  })

  it("a running container keeps missing-provider-auth on the banner after the upgrade succeeds", async () => {
    __setDockerInspectForTests({
      inspect: vi.fn().mockResolvedValue({ running: true, exitCode: null, publishedPort: 18789 }),
    })
    __setDashboardUpgradeProbeForTests(async () => ({ ok: true, status: 101, body: "" }))
    ;(prismaMock.deployment.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({ errorMessage: null })
    const sentence = 'No API key found for provider "anthropic". missing-provider-auth'
    const live = await readSelfHostDashboardStatus({
      id: "ws-1",
      status: "RUNNING",
      provider: "DOCKER",
      containerId: "ctr-up",
      containerHost: "claws-ws-1:18789",
      healthStatus: "UNHEALTHY",
      lastHealthReason: sentence,
    })
    expect(live.healthStatus).toBe("UNHEALTHY")
    expect(live.errorMessage).toContain("No API key found for provider")
    expect(prismaMock.workspace.update).not.toHaveBeenCalled()
  })

  it("leaves a hibernated container stopped without flipping it to ERROR", async () => {
    __setDockerInspectForTests({
      inspect: vi.fn().mockResolvedValue({ running: false, exitCode: 0, publishedPort: null }),
    })
    const live = await readSelfHostDashboardStatus({
      id: "ws-1",
      status: "HIBERNATED",
      provider: "DOCKER",
      containerId: "ctr-asleep",
    })
    expect(live.status).toBe("HIBERNATED")
    expect(prismaMock.workspace.update).not.toHaveBeenCalled()
  })
})
