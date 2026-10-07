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
    fireEvent.click(screen.getByRole("button", { name: /Schedule deletion/i }))

    await waitFor(() => {
      expect(show).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "error" }),
      )
    })
    expect(signOut).not.toHaveBeenCalled()
  })

  it("schedules deletion on res.ok and stays signed in (14-day grace)", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, data: { scheduled: true } }),
    }) as unknown as typeof fetch

    render(
      <AccountSettings
        user={{ id: "u1", name: "Ada", email: "ada@example.com", image: null }}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Delete account" }))
    fireEvent.click(screen.getByRole("button", { name: /Schedule deletion/i }))

    await waitFor(() => {
      expect(show).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining("14 days") }),
      )
    })
    expect(signOut).not.toHaveBeenCalled()
  })

  it("MUTATION: grace path must not signOut (session stays so the user can cancel)", () => {
    const src = readFileSync(
      join(process.cwd(), "src/components/settings/account-settings.tsx"),
      "utf8",
    )
    const deleteBlock = src.slice(src.indexOf("const handleDelete"), src.indexOf("return ("))
    expect(deleteBlock).toContain("if (!res.ok)")
    expect(deleteBlock).not.toContain("signOut")
  })
})
