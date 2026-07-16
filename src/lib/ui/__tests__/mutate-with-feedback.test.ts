import { describe, expect, it, vi } from "vitest"
import { mutateWithFeedback } from "@/lib/ui/mutate-with-feedback"

describe("mutateWithFeedback", () => {
  it("runs op then shows snackbar with undo", async () => {
    const op = vi.fn().mockResolvedValue(undefined)
    const show = vi.fn()
    const undo = vi.fn()
    await mutateWithFeedback(op, { message: "Removed", undo }, show)
    expect(op).toHaveBeenCalledTimes(1)
    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Removed",
        variant: "undo-action",
        onUndo: undo,
      }),
    )
  })

  it("on failure shows error-variant snackbar with no undo and rethrows", async () => {
    const show = vi.fn()
    const undo = vi.fn()
    await expect(
      mutateWithFeedback(
        async () => {
          throw new Error("HTTP 500")
        },
        { message: "Saved", undo, errorMessage: "Could not save" },
        show,
      ),
    ).rejects.toThrow("HTTP 500")
    expect(show).toHaveBeenCalledTimes(1)
    expect(show).toHaveBeenCalledWith({
      message: "Could not save",
      variant: "error",
    })
    // MUTATION: success path must not run after throw (no undo on error).
    expect(show.mock.calls[0][0].onUndo).toBeUndefined()
  })

  it("does not apply success message when op throws (state-update honesty)", async () => {
    const show = vi.fn()
    let applied = false
    await expect(
      mutateWithFeedback(
        async () => {
          throw new Error("nope")
        },
        { message: "Agent paused" },
        show,
      ),
    ).rejects.toThrow("nope")
    // Callers must only mutate state inside op after res.ok — helper must not
    // claim success. This lock fails if we show success after a throw.
    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({ variant: "error" }),
    )
    expect(show).not.toHaveBeenCalledWith(
      expect.objectContaining({ message: "Agent paused" }),
    )
    expect(applied).toBe(false)
  })
})
