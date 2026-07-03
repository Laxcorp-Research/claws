import { describe, expect, it } from "vitest"
import { getRedeployApiErrorMessage } from "@/components/dashboard/redeploy-error"

describe("getRedeployApiErrorMessage", () => {
  it("returns the API error body message for pre-flight redeploy failures", () => {
    expect(
      getRedeployApiErrorMessage({
        success: false,
        error: {
          code: "NO_SERVICE",
          message: "Workspace has no deployed service in ERROR state. Use the deploy flow for this state.",
          statusCode: 400,
        },
      }),
    ).toBe("Workspace has no deployed service in ERROR state. Use the deploy flow for this state.")
  })

  it("falls back for malformed error bodies", () => {
    expect(getRedeployApiErrorMessage({ success: false })).toBe("Redeploy failed")
  })
})
