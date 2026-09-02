// @vitest-environment jsdom

import { describe, it, expect, afterEach, vi, beforeEach } from "vitest"
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react"
import { DocumentCard } from "@/components/dashboard/document-card"

afterEach(() => cleanup())

const props = {
  workspaceId: "ws-1",
  fileVersionId: "fv-1",
  title: "x-content-cycle",
  preview: "Draft A",
  logicalPath: "shared/deliverables/x-content-cycle.md",
  deliverableKind: "decision" as const,
  humanRequestId: "hr-1",
  timestamp: "2026-09-01T12:00:00.000Z",
}

describe("DocumentCard decision path", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ data: { content: "# hi", decision: "NONE" } }),
      }),
    )
  })

  it("Open uses DocumentViewer", async () => {
    render(<DocumentCard {...props} />)
    fireEvent.click(screen.getByRole("button", { name: "Open" }))
    await waitFor(() => {
      expect(screen.getByTestId("document-viewer-body")).toBeTruthy()
    })
    expect(screen.getByTestId("document-viewer-actions")).toBeTruthy()
    expect(screen.getByTestId("document-viewer-prose")).toBeTruthy()
  })

  it("Approve posts the FileVersion-keyed respond path", async () => {
    render(<DocumentCard {...props} />)
    fireEvent.click(screen.getByRole("button", { name: "Approve" }))
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/workspaces/ws-1/respond",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            action: "approve",
            fileVersionId: "fv-1",
            activityLogId: "hr-1",
          }),
        }),
      )
    })
  })
})
