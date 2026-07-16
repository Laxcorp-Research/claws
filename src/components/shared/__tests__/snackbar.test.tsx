/**
 * Snackbar unit — variants, auto-dismiss, single-slot.
 */
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { SnackbarProvider, useSnackbar } from "@/components/shared/snackbar"

function Probe() {
  const { show } = useSnackbar()
  return (
    <div>
      <button type="button" onClick={() => show({ message: "Saved", variant: "success" })}>
        success
      </button>
      <button type="button" onClick={() => show({ message: "Note", variant: "info" })}>
        info
      </button>
      <button
        type="button"
        onClick={() =>
          show({
            message: "Gone",
            onUndo: async () => {},
          })
        }
      >
        undo
      </button>
      <button
        type="button"
        onClick={() => show({ message: "Failed", variant: "error" })}
      >
        error
      </button>
      <button
        type="button"
        onClick={() => show({ message: "A" })}
      >
        first
      </button>
      <button type="button" onClick={() => show({ message: "B" })}>
        second
      </button>
    </div>
  )
}

describe("Snackbar", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it("renders success / info / undo-action / error variants", () => {
    render(
      <SnackbarProvider>
        <Probe />
      </SnackbarProvider>,
    )
    fireEvent.click(screen.getByRole("button", { name: "success" }))
    expect(screen.getByTestId("snackbar").getAttribute("data-variant")).toBe("success")
    fireEvent.click(screen.getByRole("button", { name: "info" }))
    expect(screen.getByTestId("snackbar").getAttribute("data-variant")).toBe("info")
    fireEvent.click(screen.getByRole("button", { name: "undo" }))
    expect(screen.getByTestId("snackbar").getAttribute("data-variant")).toBe("undo-action")
    expect(screen.getByRole("button", { name: "Undo" })).toBeDefined()
    fireEvent.click(screen.getByRole("button", { name: "error" }))
    expect(screen.getByTestId("snackbar").getAttribute("data-variant")).toBe("error")
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull()
  })

  it("auto-dismisses after ~8s and keeps a single slot", () => {
    render(
      <SnackbarProvider>
        <Probe />
      </SnackbarProvider>,
    )
    fireEvent.click(screen.getByRole("button", { name: "first" }))
    expect(screen.getByText("A")).toBeDefined()
    fireEvent.click(screen.getByRole("button", { name: "second" }))
    expect(screen.getByText("B")).toBeDefined()
    expect(screen.queryByText("A")).toBeNull()
    expect(screen.getAllByTestId("snackbar")).toHaveLength(1)

    act(() => {
      vi.advanceTimersByTime(8000)
    })
    expect(screen.queryByTestId("snackbar")).toBeNull()
  })
})
