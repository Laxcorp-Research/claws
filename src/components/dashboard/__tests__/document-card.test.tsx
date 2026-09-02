// @vitest-environment jsdom

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest"
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react"
import { DocumentCard } from "@/components/dashboard/document-card"

const mockShow = vi.hoisted(() => vi.fn())
vi.mock("@/components/shared/snackbar", () => ({
  useSnackbarOptional: () => ({ show: mockShow }),
}))

afterEach(() => {
  cleanup()
  mockShow.mockReset()
})

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
    render(<DocumentCard {...props} decision="NONE" />)
    fireEvent.click(screen.getByRole("button", { name: "Open" }))
    await waitFor(() => {
      expect(screen.getByTestId("document-viewer-body")).toBeTruthy()
    })
    expect(screen.getByTestId("document-viewer-actions")).toBeTruthy()
    expect(screen.getByTestId("document-viewer-prose")).toBeTruthy()
  })

  it("Approve posts the FileVersion-keyed respond path", async () => {
    render(<DocumentCard {...props} decision="NONE" />)
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

  it("shows Approved/Rejected/Superseded instead of live buttons", () => {
    const { rerender } = render(<DocumentCard {...props} decision="APPROVED" />)
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull()
    expect(screen.getByTestId("document-card-status").textContent).toContain("Approved")

    rerender(<DocumentCard {...props} decision="REJECTED" />)
    expect(screen.queryByRole("button", { name: "Reject" })).toBeNull()
    expect(screen.getByTestId("document-card-status").textContent).toBe("Rejected")

    rerender(<DocumentCard {...props} decision="SUPERSEDED" latestLabel="Sep 2" />)
    expect(screen.queryByTestId("document-card-actions")).toBeNull()
    expect(screen.getByTestId("document-card-status").textContent).toBe(
      "Superseded - see Sep 2 version",
    )
  })

  it("snackbar names the API reason instead of bare Could not approve", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          error: { message: "superseded by the Sep 2 version - open latest" },
        }),
      }),
    )
    render(<DocumentCard {...props} decision="NONE" />)
    fireEvent.click(screen.getByRole("button", { name: "Approve" }))
    await waitFor(() => {
      expect(mockShow).toHaveBeenCalledWith(
        expect.objectContaining({
          variant: "error",
          message: "superseded by the Sep 2 version - open latest",
        }),
      )
    })
    expect(mockShow).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: "Could not approve" }),
    )
  })

  it("MUTATION: live-buttons-on-decided restored fails", () => {
    const src = readFileSync(
      join(process.cwd(), "src/components/dashboard/document-card.tsx"),
      "utf8",
    )
    expect(src).toContain('decision === "NONE"')
    expect(src).toContain("document-card-actions")
    expect(src).toContain("document-card-status")
    expect(src).toContain("messageFromRespondBody")
    expect(src).not.toMatch(/errorMessage: action === "approve" \? "Could not approve"/)
  })
})
