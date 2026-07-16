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

  it("does not show snackbar when op throws", async () => {
    const show = vi.fn()
    await expect(
      mutateWithFeedback(
        async () => {
          throw new Error("fail")
        },
        { message: "Nope" },
        show,
      ),
    ).rejects.toThrow("fail")
    expect(show).not.toHaveBeenCalled()
  })
})
