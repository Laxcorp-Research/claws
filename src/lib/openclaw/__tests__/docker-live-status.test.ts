import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

import {
  __setDockerInspectForTests,
  readSelfHostDashboardStatus,
} from "@/lib/openclaw/docker-live-status"

beforeEach(() => {
  __setDockerInspectForTests(null)
  process.env.CLAWS_PROFILE = "self-host"
})

afterEach(() => {
  __setDockerInspectForTests(null)
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
