/**
 * Batch D4 — agent delete requires ConfirmDialog before deleteAgent.
 * MUTATION: immediate deleteAgent without confirm → fail.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

describe("PropertiesPanel agent delete confirm", () => {
  it("MUTATION: source uses ConfirmDialog and confirm before deleteAgent", () => {
    const src = readFileSync(
      join(process.cwd(), "src/components/builder/properties-panel.tsx"),
      "utf8",
    )
    expect(src).toContain("ConfirmDialog")
    expect(src).toContain("handleDeleteConfirm")
    expect(src).toContain("setDeleteConfirmOpen(true)")
    expect(src).toContain("Agent removed")

    const removeButtonIdx = src.indexOf('onClick={() => setDeleteConfirmOpen(true)}')
    expect(removeButtonIdx).toBeGreaterThanOrEqual(0)
    const confirmBlock = src.slice(removeButtonIdx, removeButtonIdx + 800)
    expect(confirmBlock).toContain("setDeleteConfirmOpen(true)")
    expect(confirmBlock).not.toContain("deleteAgent")

    const confirmHandler = src.slice(
      src.indexOf("function handleDeleteConfirm"),
      src.indexOf("return (", src.indexOf("function handleDeleteConfirm")),
    )
    expect(confirmHandler).toContain("deleteAgent")
    expect(confirmHandler).toContain("mutateWithFeedback")
    expect(confirmHandler).toContain("Agent removed")
    expect(confirmHandler).not.toContain("undo")
  })
})
