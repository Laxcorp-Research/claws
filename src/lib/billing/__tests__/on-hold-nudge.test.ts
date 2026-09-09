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

import { nudgeOnHoldOwners } from "@/lib/billing/on-hold-nudge"

describe("nudgeOnHoldOwners", () => {
  beforeEach(() => {
    mockNudge.mockReset().mockResolvedValue({ sent: true, channel: "email" })
  })

  it("nudges every non-draft workspace whose owner is on_hold", async () => {
    ;(prismaMock.workspace.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: "ws-canary" },
    ])
    const result = await nudgeOnHoldOwners()
    expect(prismaMock.workspace.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          user: { subscriptionStatus: "on_hold" },
        }),
      }),
    )
    expect(mockNudge).toHaveBeenCalledWith({
      workspaceId: "ws-canary",
      condition: "subscription-on-hold",
    })
    expect(result.nudged).toBe(1)
  })
})
