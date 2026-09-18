// @vitest-environment jsdom

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { NeedsYouSection } from "@/components/dashboard/needs-you-section"

afterEach(() => cleanup())

const approval = {
  fileVersionId: "fv-1",
  title: "x-content-cycle",
  preview: "Draft A for the human.",
  logicalPath: "shared/deliverables/x-content-cycle.md",
  deliverableKind: "decision" as const,
  humanRequestId: "hr-1",
  timestamp: "2026-09-01T12:00:00.000Z",
}

describe("NeedsYouSection", () => {
  it("renders nothing when there are no approvals (calm-by-default)", () => {
    const { container } = render(
      <NeedsYouSection workspaceId="ws-1" approvals={[]} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it("renders title, preview, Open, and Approve/Edit/Reject from DocumentCard", () => {
    render(<NeedsYouSection workspaceId="ws-1" approvals={[approval]} />)
    expect(screen.getByText("Needs you (1 item)")).toBeTruthy()
    expect(screen.getByText("x-content-cycle")).toBeTruthy()
    expect(screen.getByText("Draft A for the human.")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Open" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy()
    expect(screen.getByRole("button", { name: "Reject" })).toBeTruthy()
    expect(screen.queryByText("Unknown")).toBeNull()
  })

  it("does not show live buttons when the approval is already decided", () => {
    render(
      <NeedsYouSection
        workspaceId="ws-1"
        approvals={[{ ...approval, decision: "APPROVED" }]}
      />,
    )
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull()
    expect(screen.getByTestId("document-card-status").textContent).toContain("Approved")
  })

  it("uses --warn for the section title, not agent green", () => {
    render(<NeedsYouSection workspaceId="ws-1" approvals={[approval]} />)
    const heading = screen.getByText("Needs you (1 item)")
    expect(heading.className).toContain("text-[var(--warn)]")
    expect(heading.className).not.toContain("text-[#")
  })

  it("renders an HTTP ACTION card with the order body", () => {
    render(
      <NeedsYouSection
        workspaceId="ws-1"
        approvals={[
          {
            kind: "http_action",
            title: "alpaca-trading POST paper-api.alpaca.markets/v2/orders",
            preview: "BUY 166 MU @ $1,017 stop $1,005",
            humanRequestId: "hr-http",
            timestamp: "2026-09-07T00:00:00.000Z",
            httpAction: {
              skill: "alpaca-trading",
              method: "POST",
              host: "paper-api.alpaca.markets",
              path: "/v2/orders",
              bodyPlain: "BUY 166 MU @ $1,017 stop $1,005",
            },
          },
        ]}
      />,
    )
    expect(screen.getByTestId("http-action-card")).toBeTruthy()
    expect(screen.getByTestId("http-action-body").textContent).toBe(
      "BUY 166 MU @ $1,017 stop $1,005",
    )
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy()
  })

  it("MUTATION: blind-approve card restored as Needs you renderer fails", () => {
    const src = readFileSync(
      join(process.cwd(), "src/components/dashboard/needs-you-section.tsx"),
      "utf8",
    )
    expect(src).toContain('from "./document-card"')
    expect(src).toContain("DocumentCard")
    expect(src).not.toContain("PendingApprovalCard")
    expect(src).not.toContain("pending-approval-card")
    expect(src).not.toContain("Unknown")
    expect(src).not.toContain("agentColor")
  })

  it("MUTATION: deleted blind card file stays gone", () => {
    const src = readFileSync(
      join(process.cwd(), "src/components/dashboard/needs-you-section.tsx"),
      "utf8",
    )
    expect(() =>
      readFileSync(join(process.cwd(), "src/components/dashboard/pending-approval-card.tsx"), "utf8"),
    ).toThrow()
    expect(src).toContain("DocumentCard")
  })
})
