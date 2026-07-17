// @vitest-environment jsdom
/**
 * Batch D — version restore failure routes through mutateWithFeedback.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const restoreSnapshot = vi.fn()
const show = vi.fn()
const loadSnapshots = vi.fn()

vi.mock("@/stores/builder-store", () => ({
  useBuilderStore: () => ({
    snapshots: [
      {
        id: "snap-current",
        version: 2,
        trigger: "MANUAL_SAVE",
        label: null,
        createdAt: new Date().toISOString(),
      },
      {
        id: "snap-old",
        version: 1,
        trigger: "MANUAL_SAVE",
        label: null,
        createdAt: new Date().toISOString(),
      },
    ],
    isLoadingSnapshots: false,
    loadSnapshots,
    restoreSnapshot,
  }),
}))

vi.mock("@/components/shared/snackbar", () => ({
  useSnackbarOptional: () => ({ show }),
}))

vi.mock("@/lib/ui/mutate-with-feedback", () => ({
  mutateWithFeedback: vi.fn(async (op: () => Promise<void>, opts: { message: string }, showFn: (o: unknown) => void) => {
    try {
      await op()
      showFn({ message: opts.message, variant: "success" })
    } catch (err) {
      showFn({
        message: err instanceof Error ? err.message : "fail",
        variant: "error",
      })
      throw err
    }
  }),
}))

import { VersionHistoryPanel } from "@/components/builder/version-history-panel"
import { mutateWithFeedback } from "@/lib/ui/mutate-with-feedback"

describe("VersionHistoryPanel restore feedback (Batch D)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal("confirm", vi.fn(() => true))
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it("Restore click wraps restoreSnapshot in mutateWithFeedback", () => {
    render(<VersionHistoryPanel open onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: "Restore" }))
    expect(mutateWithFeedback).toHaveBeenCalled()
    expect(restoreSnapshot).toHaveBeenCalledWith("snap-old")
  })

  it("MUTATION: bypass mutateWithFeedback on restore → fail", () => {
    const src = readFileSync(
      join(process.cwd(), "src/components/builder/version-history-panel.tsx"),
      "utf8",
    )
    expect(src).toContain("mutateWithFeedback")
    expect(src).toContain("Could not restore version")
  })
})
