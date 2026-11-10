// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { ClawHealthLine, formatClawHealthHistory } from "@/components/dashboard/claw-health-line"

describe("ClawHealthLine", () => {
  it("renders healed history and only one active nudge", () => {
    expect(formatClawHealthHistory(2)).toBe("Claw health: auto-recovered \u00d72 this week")
    render(
      <ClawHealthLine
        recoveredThisWeek={2}
        nudge={{
          id: "spend-limit",
          variant: "error",
          message: <p>Monthly API spend limit reached</p>,
        }}
      />,
    )
    expect(screen.getByText("Claw health: auto-recovered \u00d72 this week")).toBeTruthy()
    expect(screen.getByText("Monthly API spend limit reached")).toBeTruthy()
    expect(screen.queryByText("more alert")).toBeNull()
  })

  it("drops all clear when a nudge is the active failure", () => {
    render(
      <ClawHealthLine
        recoveredThisWeek={0}
        nudge={{
          id: "container-error",
          variant: "error",
          message: <p>Proxy client attribution is required.</p>,
        }}
      />,
    )
    expect(screen.queryByText("Claw health: all clear")).toBeNull()
    expect(screen.getByText("Proxy client attribution is required.")).toBeTruthy()
  })

  it("MUTATION: dashboard must use ClawHealthLine, not a multi-banner stack", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/dashboard/[workspaceId]/page.tsx"),
      "utf8",
    )
    expect(src).toContain("ClawHealthLine")
    expect(src).not.toContain("<AlertStack")
  })
})
