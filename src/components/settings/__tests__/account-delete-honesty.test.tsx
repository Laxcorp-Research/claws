// @vitest-environment jsdom
/**
 * Batch F - Account Delete: signOut ONLY on res.ok.
 * MUTATION: signOut on !ok → fail.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const signOut = vi.fn()
const show = vi.fn()

vi.mock("next-auth/react", () => ({
  signOut: (...args: unknown[]) => signOut(...args),
}))

vi.mock("@/components/shared/snackbar", () => ({
  useSnackbarOptional: () => ({ show }),
}))

import { AccountSettings } from "@/components/settings/account-settings"

afterEach(() => cleanup())

beforeEach(() => {
  vi.clearAllMocks()
  signOut.mockResolvedValue(undefined)
})

describe("AccountSettings delete honesty (Batch F)", () => {
  it("does not signOut when DELETE returns !ok; shows error snackbar", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ success: false }),
    }) as unknown as typeof fetch

    render(
      <AccountSettings
        user={{ id: "u1", name: "Ada", email: "ada@example.com", image: null }}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Delete account" }))
    fireEvent.click(screen.getByRole("button", { name: /Delete my account/i }))

    await waitFor(() => {
      expect(show).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "error" }),
      )
    })
    expect(signOut).not.toHaveBeenCalled()
  })

  it("signOut only after res.ok", async () => {
    // Avoid real navigation
    const hrefSetter = vi.fn()
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, set href(v: string) { hrefSetter(v) }, get href() { return "http://localhost/" } },
    })

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    }) as unknown as typeof fetch

    render(
      <AccountSettings
        user={{ id: "u1", name: "Ada", email: "ada@example.com", image: null }}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Delete account" }))
    fireEvent.click(screen.getByRole("button", { name: /Delete my account/i }))

    await waitFor(() => {
      expect(signOut).toHaveBeenCalledWith({ redirect: false })
    })
  })

  it("MUTATION: signOut on !ok → fail (source guard)", () => {
    const src = readFileSync(
      join(process.cwd(), "src/components/settings/account-settings.tsx"),
      "utf8",
    )
    expect(src).toContain("mutateWithFeedback")
    const deleteBlock = src.slice(src.indexOf("const handleDelete"), src.indexOf("return ("))
    expect(deleteBlock).toContain("if (!res.ok)")
    // Call site after the ok gate (not the comment mentioning signOut).
    const afterOk = deleteBlock.slice(deleteBlock.indexOf("if (!res.ok)"))
    expect(afterOk).toContain("await signOut(")
    // Must not call signOut before checking ok inside the op.
    const opStart = deleteBlock.indexOf("async () => {")
    const opBody = deleteBlock.slice(opStart, deleteBlock.indexOf("if (!res.ok)"))
    expect(opBody).not.toContain("await signOut(")
  })
})
