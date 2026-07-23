// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import SignInPage from "@/app/auth/signin/page"

const mockReplace = vi.fn()
const mockSignIn = vi.fn()

vi.mock("next-auth/react", () => ({
  signIn: (...args: unknown[]) => mockSignIn(...args),
  useSession: () => ({ data: null, status: "unauthenticated" }),
}))

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/auth/signin",
}))

describe("SignInPage magic link honesty", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSignIn.mockResolvedValue({ ok: true, error: null })
  })

  afterEach(() => {
    cleanup()
  })

  it("shows success banner only when signIn succeeds", async () => {
    render(<SignInPage />)
    fireEvent.change(screen.getByPlaceholderText("Email address"), {
      target: { value: "user@example.com" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Send magic link" }))

    await waitFor(() => {
      expect(screen.getByText(/Check your email/)).toBeTruthy()
    })
    expect(
      screen.queryByText("Could not send magic link. Check the email and try again."),
    ).toBeNull()
  })

  it("shows error banner when signIn returns error (no success state)", async () => {
    mockSignIn.mockResolvedValue({ ok: false, error: "EmailSignin" })
    render(<SignInPage />)
    fireEvent.change(screen.getByPlaceholderText("Email address"), {
      target: { value: "bad@example.com" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Send magic link" }))

    expect(
      await screen.findByText("Could not send magic link. Check the email and try again."),
    ).toBeTruthy()
    expect(screen.queryByText(/Check your email/)).toBeNull()
  })
})
