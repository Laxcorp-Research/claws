// @vitest-environment jsdom
//
// PR-6: NeedsYouSection is calm-by-default (absent when empty) and otherwise
// wires approve inline + reject-through-a-feedback-modal. These guard the
// empty-render contract and the two action paths.

import { describe, it, expect, afterEach, vi } from "vitest"
import { render, screen, cleanup, fireEvent } from "@testing-library/react"
import { NeedsYouSection } from "@/components/dashboard/needs-you-section"

afterEach(() => cleanup())

const approval = {
  id: "log-1",
  title: "Orchestrator requests approval",
  description: "Send the Q3 outreach batch",
  agentName: "Orchestrator",
  agentColor: "#5BA1F5",
  timestamp: "08:00:00 UTC",
}

describe("NeedsYouSection", () => {
  it("renders nothing when there are no approvals (calm-by-default)", () => {
    const { container } = render(
      <NeedsYouSection approvals={[]} onApprove={vi.fn()} onReject={vi.fn()} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it("renders the section with a count and the approval card when present", () => {
    render(<NeedsYouSection approvals={[approval]} onApprove={vi.fn()} onReject={vi.fn()} />)
    expect(screen.getByText("Needs you (1 item)")).toBeTruthy()
    expect(screen.getByText("Orchestrator requests approval")).toBeTruthy()
  })

  it("calls onApprove with the id when Approve is clicked", () => {
    const onApprove = vi.fn().mockResolvedValue(undefined)
    render(<NeedsYouSection approvals={[approval]} onApprove={onApprove} onReject={vi.fn()} />)
    fireEvent.click(screen.getByText("Approve"))
    expect(onApprove).toHaveBeenCalledWith("log-1")
  })

  it("opens the reject-feedback modal (does not reject immediately) when Reject is clicked", () => {
    const onReject = vi.fn().mockResolvedValue(undefined)
    render(<NeedsYouSection approvals={[approval]} onApprove={vi.fn()} onReject={onReject} />)
    fireEvent.click(screen.getByText("Reject"))
    expect(screen.getByText("Reject this item?")).toBeTruthy()
    // reject is only sent after confirming in the modal
    expect(onReject).not.toHaveBeenCalled()
  })
})
