import { describe, expect, it } from "vitest"
import {
  buildCustomerNudgeText,
  decideCustomerNudge,
  isUserOnlyNudgeCondition,
  userOnlyNudgeConditionIds,
} from "@/lib/alerts/customer-nudge"
import { getHealPolicy } from "@/lib/healing/registry"

describe("customer nudge", () => {
  it("only user-only registry rows (plus spend-limit) are nudgeable", () => {
    for (const id of userOnlyNudgeConditionIds()) {
      if (id === "spend-limit-100") {
        expect(getHealPolicy(id).ruling).toBe("platform")
        continue
      }
      expect(getHealPolicy(id).ruling).toBe("user-only")
    }
    expect(isUserOnlyNudgeCondition("bad-token")).toBe(false)
    expect(decideCustomerNudge({ condition: "bad-token", openNudgeAt: null }).action).toBe("skip")
  })

  it("dedups while a nudge is still open", () => {
    expect(
      decideCustomerNudge({
        condition: "oauth-expired",
        openNudgeAt: new Date("2026-08-31T10:00:00Z"),
      }),
    ).toEqual({ action: "skip", reason: "already-open" })
    expect(decideCustomerNudge({ condition: "oauth-expired", openNudgeAt: null })).toEqual({
      action: "send",
    })
  })

  it("copy is what we tried plus the one action", () => {
    const text = buildCustomerNudgeText("spend-limit-100")
    expect(text).toContain("synced and paused")
    expect(text).toContain("One action:")
    expect(text).toContain("Raise the spend limit")
  })
})
