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

// Founder screenshot 2026-08-25: the sent-state banner overflowed the 540px
// column (whitespace-nowrap) and the page dead-ended - form gone, no resend,
// no way back. These lock the fixed sent-state.
describe("SignInPage sent-state layout and escape hatches", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSignIn.mockResolvedValue({ ok: true, error: null })
  })

  afterEach(() => {
    cleanup()
  })

  async function sendLink() {
    render(<SignInPage />)
    fireEvent.change(screen.getByPlaceholderText("Email address"), {
      target: { value: "user@example.com" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Send magic link" }))
    await waitFor(() => {
      expect(screen.getByText(/We sent a magic link/)).toBeTruthy()
    })
  }

  it("REGRESSION: banner text wraps - no whitespace-nowrap (it overflowed the column)", async () => {
    await sendLink()
    const p = document.querySelector('[role="status"] p')
    expect(p).toBeTruthy()
    expect(p?.className ?? "").not.toContain("whitespace-nowrap")
  })

  it("sent state offers 'Send again' which re-fires the email signIn", async () => {
    await sendLink()
    fireEvent.click(screen.getByRole("button", { name: "Didn't get it? Send again" }))
    await waitFor(() => {
      expect(mockSignIn).toHaveBeenCalledTimes(2)
    })
    expect(mockSignIn).toHaveBeenLastCalledWith(
      "email",
      expect.objectContaining({ email: "user@example.com", redirect: false }),
    )
  })

  it("'Use a different email' returns to the form with the address preserved (no dead end)", async () => {
    await sendLink()
    fireEvent.click(screen.getByRole("button", { name: "Use a different email" }))
    const input = screen.getByPlaceholderText("Email address") as HTMLInputElement
    expect(input.value).toBe("user@example.com")
    expect(screen.getByRole("button", { name: "Send magic link" })).toBeTruthy()
    expect(screen.queryByText(/We sent a magic link/)).toBeNull()
  })

  it("a failed resend surfaces the error inside the sent state (previously invisible)", async () => {
    await sendLink()
    mockSignIn.mockResolvedValue({ ok: false, error: "EmailSignin" })
    fireEvent.click(screen.getByRole("button", { name: "Didn't get it? Send again" }))
    expect(
      await screen.findByText("Could not send magic link. Check the email and try again."),
    ).toBeTruthy()
    // Still in the sent state - the banner remains visible alongside the error.
    expect(screen.getByText(/We sent a magic link/)).toBeTruthy()
  })
})
