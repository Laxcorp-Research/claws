import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  DEPLOYED_EVIDENCE_STATUSES,
  decideRefundWorkspaceAction,
  daysSincePurchase,
} from "@/lib/marketplace/refund-policy"

describe("PR-6 refund workspace policy (4 quadrants)", () => {
  const now = new Date("2026-08-11T12:00:00.000Z")
  const day = 86_400_000

  it("early × never-deployed → delete workspace", () => {
    const d = decideRefundWorkspaceAction({
      hasWorkspace: true,
      purchaseCreatedAt: new Date(now.getTime() - 2 * day),
      hasSuccessfulDeploy: false,
      now,
    })
    expect(d).toEqual({
      deleteWorkspace: true,
      reason: "within_window_and_never_deployed",
    })
  })

  it("early × deployed → retain workspace", () => {
    const d = decideRefundWorkspaceAction({
      hasWorkspace: true,
      purchaseCreatedAt: new Date(now.getTime() - 1 * day),
      hasSuccessfulDeploy: true,
      now,
    })
    expect(d.deleteWorkspace).toBe(false)
    expect(d.reason).toBe("already_deployed")
  })

  it("late × never-deployed → retain workspace", () => {
    const d = decideRefundWorkspaceAction({
      hasWorkspace: true,
      purchaseCreatedAt: new Date(now.getTime() - 10 * day),
      hasSuccessfulDeploy: false,
      now,
    })
    expect(d.deleteWorkspace).toBe(false)
    expect(d.reason).toBe("outside_window")
  })

  it("late × deployed → retain workspace", () => {
    const d = decideRefundWorkspaceAction({
      hasWorkspace: true,
      purchaseCreatedAt: new Date(now.getTime() - 10 * day),
      hasSuccessfulDeploy: true,
      now,
    })
    expect(d.deleteWorkspace).toBe(false)
    expect(d.reason).toBe("outside_window_and_deployed")
  })

  it("day boundary: day 7 still within window", () => {
    expect(daysSincePurchase(new Date(now.getTime() - 7 * day), now)).toBe(7)
    const d = decideRefundWorkspaceAction({
      hasWorkspace: true,
      purchaseCreatedAt: new Date(now.getTime() - 7 * day),
      hasSuccessfulDeploy: false,
      now,
    })
    expect(d.deleteWorkspace).toBe(true)
  })

  it("deployed evidence statuses are COMPLETED + SUPERSEDED", () => {
    expect(DEPLOYED_EVIDENCE_STATUSES).toEqual(["COMPLETED", "SUPERSEDED"])
  })

  it("MUTATION: webhook wires cancelPayout + decideRefundWorkspaceAction", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/api/dodo-payments/webhook/route.ts"),
      "utf8",
    )
    expect(src).toContain("cancelPayout")
    expect(src).toContain("decideRefundWorkspaceAction")
    expect(src).toContain("DEPLOYED_EVIDENCE_STATUSES")
    expect(src).toContain("refund.succeeded.workspace_retained")
    // Old calendar-only delete must not return.
    expect(src).not.toMatch(/if \(days <= 7\) await prisma\.workspace\.delete/)
  })
})
