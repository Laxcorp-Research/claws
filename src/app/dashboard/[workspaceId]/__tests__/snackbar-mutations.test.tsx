/**
 * PR-4 representative coverage: Live Ops agent control + Needs You approve.
 * Success → snackbar; failure → error variant (state not updated).
 */
// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SnackbarProvider, useSnackbarOptional } from "@/components/shared/snackbar"
import { mutateWithFeedback } from "@/lib/ui/mutate-with-feedback"

function Probe({
  run,
}: {
  run: (show: NonNullable<ReturnType<typeof useSnackbarOptional>>["show"]) => Promise<void>
}) {
  const snackbar = useSnackbarOptional()
  return (
    <button
      type="button"
      onClick={() => {
        if (snackbar) void run(snackbar.show)
      }}
    >
      go
    </button>
  )
}

describe("PR-4 dashboard mutation feedback patterns", () => {
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it("agent pause success fires success snackbar", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true })
    const { getByRole, getByTestId, getByText } = render(
      <SnackbarProvider>
        <Probe
          run={async (show) => {
            await mutateWithFeedback(
              async () => {
                const res = await fetch("/api/agents/ws/a1/control", {
                  method: "POST",
                  body: JSON.stringify({ action: "pause" }),
                })
                if (!res.ok) throw new Error("fail")
              },
              { message: "Agent paused", errorMessage: "Could not pause agent" },
              show,
            )
          }}
        />
      </SnackbarProvider>,
    )
    getByRole("button", { name: "go" }).click()
    await waitFor(() => expect(getByTestId("snackbar").getAttribute("data-variant")).toBe("success"))
    expect(getByText("Agent paused")).toBeDefined()
  })

  it("approve failure fires error snackbar and does not claim Approved", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 })
    let removed = false
    const { getByRole, getByTestId, queryByText } = render(
      <SnackbarProvider>
        <Probe
          run={async (show) => {
            try {
              await mutateWithFeedback(
                async () => {
                  const res = await fetch("/api/workspaces/ws/respond", { method: "POST" })
                  if (!res.ok) throw new Error("Could not approve")
                  removed = true
                },
                { message: "Approved", errorMessage: "Could not approve" },
                show,
              )
            } catch {
              /* expected */
            }
          }}
        />
      </SnackbarProvider>,
    )
    getByRole("button", { name: "go" }).click()
    await waitFor(() => expect(getByTestId("snackbar").getAttribute("data-variant")).toBe("error"))
    expect(queryByText("Approved")).toBeNull()
    expect(removed).toBe(false)
  })
})
