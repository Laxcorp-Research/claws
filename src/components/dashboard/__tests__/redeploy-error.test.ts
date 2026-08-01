import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
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

  it("Card 18: STOPPED redeploy snackbar surfaces TOPOLOGY_INVALID detail", () => {
    expect(
      getRedeployApiErrorMessage(
        {
          success: false,
          error: {
            code: "TOPOLOGY_INVALID",
            message:
              "Review is automatic — every worker's output goes through the reviewer before it reaches you.",
          },
        },
        "Could not restart Claw (400)",
      ),
    ).toContain("Review is automatic")
  })

  it("MUTATION lock: handleRedeployFromStopped must parse API error (opaque Could not restart alone fails)", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/dashboard/[workspaceId]/page.tsx"),
      "utf8",
    )
    const idx = src.indexOf("handleRedeployFromStopped")
    expect(idx).toBeGreaterThanOrEqual(0)
    const window = src.slice(idx, idx + 900)
    expect(window).toContain("getRedeployApiErrorMessage")
    expect(window).toContain("/api/deploy/${workspaceId}/cloud")
    // Must not hardcode opaque errorMessage that swallows API detail.
    expect(window).not.toMatch(
      /errorMessage:\s*["']Could not restart Claw["']/,
    )
  })
})
