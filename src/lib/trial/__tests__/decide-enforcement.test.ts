import { describe, it, expect } from "vitest"
import {
  decideEnforcementActions,
  type UserWithWorkspaces,
} from "@/lib/trial/decide-enforcement"

const NOW = new Date("2026-04-25T00:00:00Z")
const EXPIRED = new Date(NOW.getTime() - 24 * 60 * 60 * 1000)
const ACTIVE = new Date(NOW.getTime() + 24 * 60 * 60 * 1000)

function makeUser(overrides: Partial<UserWithWorkspaces> = {}): UserWithWorkspaces {
  return {
    id: "user-1",
    trialUsed: true,
    trialEndsAt: EXPIRED,
    hasActiveSubscription: false,
    workspaces: [],
    ...overrides,
  }
}

describe("decideEnforcementActions", () => {
  it("returns all RUNNING workspaces for a user with expired trial and no subscription", () => {
    const plan = decideEnforcementActions(
      [
        makeUser({
          id: "u1",
          workspaces: [
            { id: "ws1", status: "RUNNING", containerId: "c1" },
            { id: "ws2", status: "RUNNING", containerId: "c2" },
          ],
        }),
      ],
      NOW,
    )
    expect(plan.toStop).toEqual([
      { userId: "u1", workspaceId: "ws1", containerId: "c1" },
      { userId: "u1", workspaceId: "ws2", containerId: "c2" },
    ])
  })

  it("returns empty toStop when trial is still active", () => {
    const plan = decideEnforcementActions(
      [
        makeUser({
          trialEndsAt: ACTIVE,
          workspaces: [{ id: "ws1", status: "RUNNING", containerId: "c1" }],
        }),
      ],
      NOW,
    )
    expect(plan.toStop).toEqual([])
  })

  it("returns empty toStop when user has active subscription (defense in depth)", () => {
    const plan = decideEnforcementActions(
      [
        makeUser({
          hasActiveSubscription: true,
          workspaces: [{ id: "ws1", status: "RUNNING", containerId: "c1" }],
        }),
      ],
      NOW,
    )
    expect(plan.toStop).toEqual([])
  })

  it("returns empty toStop when trialUsed is false (defense in depth)", () => {
    const plan = decideEnforcementActions(
      [
        makeUser({
          trialUsed: false,
          workspaces: [{ id: "ws1", status: "RUNNING", containerId: "c1" }],
        }),
      ],
      NOW,
    )
    expect(plan.toStop).toEqual([])
  })

  it("returns empty toStop when all workspaces are non-RUNNING", () => {
    const plan = decideEnforcementActions(
      [
        makeUser({
          workspaces: [
            { id: "ws1", status: "PAUSED", containerId: "c1" },
            { id: "ws2", status: "HIBERNATED", containerId: "c2" },
            { id: "ws3", status: "DEPLOYING", containerId: "c3" },
          ],
        }),
      ],
      NOW,
    )
    expect(plan.toStop).toEqual([])
  })

  it("treats trialEndsAt=null as expired when trialUsed is true (matches checkDeployEligibility)", () => {
    const plan = decideEnforcementActions(
      [
        makeUser({
          trialEndsAt: null,
          workspaces: [{ id: "ws1", status: "RUNNING", containerId: "c1" }],
        }),
      ],
      NOW,
    )
    expect(plan.toStop).toEqual([
      { userId: "user-1", workspaceId: "ws1", containerId: "c1" },
    ])
  })

  it("handles a mix of qualifying and non-qualifying users correctly", () => {
    const plan = decideEnforcementActions(
      [
        makeUser({
          id: "u-expired",
          workspaces: [{ id: "ws-1", status: "RUNNING", containerId: "c1" }],
        }),
        makeUser({
          id: "u-active",
          trialEndsAt: ACTIVE,
          workspaces: [{ id: "ws-2", status: "RUNNING", containerId: "c2" }],
        }),
        makeUser({
          id: "u-subbed",
          hasActiveSubscription: true,
          workspaces: [{ id: "ws-3", status: "RUNNING", containerId: "c3" }],
        }),
        makeUser({
          id: "u-expired2",
          workspaces: [
            { id: "ws-4", status: "RUNNING", containerId: "c4" },
            { id: "ws-5", status: "PAUSED", containerId: "c5" },
          ],
        }),
      ],
      NOW,
    )
    expect(plan.toStop).toEqual([
      { userId: "u-expired", workspaceId: "ws-1", containerId: "c1" },
      { userId: "u-expired2", workspaceId: "ws-4", containerId: "c4" },
    ])
  })
})
