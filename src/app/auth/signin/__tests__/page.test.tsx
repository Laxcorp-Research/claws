// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import SignInPage from "@/app/auth/signin/page"
import {
  LEGAL_URLS,
  SIGNUP_CONSENT_LABEL,
  TOS_CONSENT_COOKIE,
  TOS_VERSION,
} from "@/lib/legal/consent"

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

/** Signup consent checkbox - every auth action requires it first. */
function tickConsent() {
  fireEvent.click(screen.getByRole("checkbox", { name: SIGNUP_CONSENT_LABEL }))
}

describe("SignInPage signup consent gate", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSignIn.mockResolvedValue({ ok: true, error: null })
    document.cookie = `${TOS_CONSENT_COOKIE}=; path=/; max-age=0`
  })

  afterEach(() => {
    cleanup()
  })

  it("blocks all three auth paths until the Terms + Privacy checkbox is ticked", () => {
    render(<SignInPage />)
    fireEvent.change(screen.getByPlaceholderText("Email address"), {
      target: { value: "user@example.com" },
    })
    const github = screen.getByRole("button", { name: /Continue with GitHub/ }) as HTMLButtonElement
    const google = screen.getByRole("button", { name: /Continue with Google/ }) as HTMLButtonElement
    const magic = screen.getByRole("button", { name: "Send magic link" }) as HTMLButtonElement
    expect(github.disabled).toBe(true)
    expect(google.disabled).toBe(true)
    expect(magic.disabled).toBe(true)

    fireEvent.click(github)
    fireEvent.click(magic)
    expect(mockSignIn).not.toHaveBeenCalled()

    tickConsent()
    expect(github.disabled).toBe(false)
    expect(google.disabled).toBe(false)
    expect(magic.disabled).toBe(false)
  })

  it("ticking the box sets the versioned consent cookie the server verifies", () => {
    render(<SignInPage />)
    tickConsent()
    expect(document.cookie).toContain(`${TOS_CONSENT_COOKIE}=${TOS_VERSION}`)
  })

  it("links the Terms and Privacy Policy to the buildclaws.ai legal pages", () => {
    render(<SignInPage />)
    const terms = screen.getByRole("link", { name: "Terms" }) as HTMLAnchorElement
    const privacy = screen.getByRole("link", { name: "Privacy Policy" }) as HTMLAnchorElement
    expect(terms.href).toBe(LEGAL_URLS.terms)
    expect(privacy.href).toBe(LEGAL_URLS.privacy)
  })
})

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
    tickConsent()
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
    tickConsent()
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
    tickConsent()
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
