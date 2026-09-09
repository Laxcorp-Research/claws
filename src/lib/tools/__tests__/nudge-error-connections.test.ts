import { beforeEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))
vi.mock("@/lib/logger", () => ({
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

const mockNudge = vi.fn()
vi.mock("@/lib/alerts/customer-nudge", () => ({
  sendCustomerNudge: (...args: unknown[]) => mockNudge(...args),
}))

import { nudgePersistedToolErrors } from "@/lib/tools/nudge-error-connections"

describe("nudgePersistedToolErrors", () => {
  beforeEach(() => {
    mockNudge.mockReset().mockResolvedValue({ sent: true, channel: "email" })
  })

  it("nudges Invalid Bearer as tool-connection-error, not twitter-402-tier", async () => {
    ;(prismaMock.toolConnection.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        workspaceId: "ws-canary",
        toolSlug: "twitter-api",
        lastError: "Invalid Twitter/X Bearer token",
      },
    ])
    const result = await nudgePersistedToolErrors()
    expect(mockNudge).toHaveBeenCalledWith({
      workspaceId: "ws-canary",
      condition: "tool-connection-error",
    })
    expect(mockNudge).not.toHaveBeenCalledWith(
      expect.objectContaining({ condition: "twitter-402-tier" }),
    )
    expect(result.nudged).toBe(1)
  })
})
