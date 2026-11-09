"use client"

import { Suspense, useState, useEffect } from "react"
import { signIn, useSession } from "next-auth/react"
import { useSearchParams, useRouter } from "next/navigation"
import { PageShell } from "@/components/shared/page-shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AlertBanner } from "@/components/ui/alert-banner"
import { Mail } from "lucide-react"
import { resolvePostAuthPath } from "@/lib/auth/post-auth-path"
import type { SignInMethods } from "@/lib/auth/signin-methods"
import {
  LEGAL_URLS,
  SIGNUP_CONSENT_LABEL,
  TOS_CONSENT_COOKIE,
  TOS_CONSENT_COOKIE_MAX_AGE_S,
  TOS_VERSION,
} from "@/lib/legal/consent"

export function SignInForm({ methods }: { methods: SignInMethods }) {
  return (
    <Suspense>
      <SignInContent methods={methods} />
    </Suspense>
  )
}

function SignInContent({ methods }: { methods: SignInMethods }) {
  const { data: session, status } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get("callbackUrl")
  const authError = searchParams.get("error")

  const [email, setEmail] = useState("")
  const [emailError, setEmailError] = useState<string | null>(null)
  const [magicLinkSent, setMagicLinkSent] = useState(false)
  const [magicLinkError, setMagicLinkError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [password, setPassword] = useState("")
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [consentChecked, setConsentChecked] = useState(false)

  // The checkbox state must survive the OAuth redirect round-trip so the
  // server (NextAuth signIn callback / createUser event) can verify AND
  // version-stamp the consent - a client-side gate alone is not evidence.
  const setConsentCookie = (checked: boolean) => {
    setConsentChecked(checked)
    if (checked) {
      document.cookie = `${TOS_CONSENT_COOKIE}=${TOS_VERSION}; path=/; max-age=${TOS_CONSENT_COOKIE_MAX_AGE_S}; SameSite=Lax`
    } else {
      document.cookie = `${TOS_CONSENT_COOKIE}=; path=/; max-age=0; SameSite=Lax`
    }
  }

  useEffect(() => {
    if (status === "authenticated") {
      // Batch B: first sign-in → /onboarding when !onboardingCompleted.
      router.replace(resolvePostAuthPath(session?.onboardingCompleted, callbackUrl))
    }
  }, [status, session?.onboardingCompleted, callbackUrl, router])

  if (status === "loading" || status === "authenticated") {
    return null
  }

  const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())

  const handleMagicLink = async () => {
    if (!email.trim()) {
      setEmailError("Please enter your email address")
      return
    }
    if (!isValidEmail) {
      setEmailError("Please enter a valid email address")
      return
    }
    setEmailError(null)
    setMagicLinkError(null)
    setLoading(true)
    const result = await signIn("email", { email, callbackUrl: callbackUrl || "/my-claws", redirect: false })
    setLoading(false)
    if (result?.error) {
      setMagicLinkError("Could not send magic link. Check the email and try again.")
      return
    }
    setMagicLinkSent(true)
  }

  const handlePasswordSignIn = async () => {
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setEmailError("Please enter a valid email address")
      return
    }
    if (!password) {
      setPasswordError("Enter your password")
      return
    }
    setEmailError(null)
    setPasswordError(null)
    setLoading(true)
    const result = await signIn("credentials", {
      email: email.trim(),
      password,
      callbackUrl: callbackUrl || "/store",
      redirect: false,
    })
    setLoading(false)
    if (result?.error) {
      setPasswordError("Wrong email or password.")
      return
    }
    router.push(callbackUrl || "/store")
  }

  if (methods.password) {
    return (
      <PageShell background="secondary">
        <div className="max-w-[540px] mx-auto py-8 text-center">
          <h1 className="text-xl font-semibold mb-1">Welcome to Claws</h1>
          <p className="text-[13px] text-[var(--tx2)] mb-5">
            Sign in to manage your AI agent teams
          </p>
          {passwordError && (
            <AlertBanner variant="error">
              <span>{passwordError}</span>
            </AlertBanner>
          )}
          <Input
            variant="auth"
            type="email"
            placeholder="Email address"
            autoComplete="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setEmailError(null) }}
          />
          {emailError && (
            <p className="text-[11px] text-[var(--err)] mt-1 mb-1 text-left">{emailError}</p>
          )}
          <Input
            variant="auth"
            type="password"
            placeholder="Password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setPasswordError(null) }}
            onKeyDown={(e) => { if (e.key === "Enter") void handlePasswordSignIn() }}
          />
          <Button
            variant="primary"
            size="full"
            loading={loading}
            onClick={() => void handlePasswordSignIn()}
          >
            Sign in
          </Button>
          {methods.github && (
            <button
              type="button"
              onClick={() => signIn("github", { callbackUrl: callbackUrl || "/store" })}
              className="flex items-center justify-center gap-2 w-full py-2.5 border border-[var(--bd)] rounded-lg text-[13px] bg-[var(--bg)] hover:bg-[var(--bg2)] transition-colors cursor-pointer mb-2"
            >
              Continue with GitHub
            </button>
          )}
          {methods.google && (
            <button
              type="button"
              onClick={() => signIn("google", { callbackUrl: callbackUrl || "/store" })}
              className="flex items-center justify-center gap-2 w-full py-2.5 border border-[var(--bd)] rounded-lg text-[13px] bg-[var(--bg)] hover:bg-[var(--bg2)] transition-colors cursor-pointer mb-2"
            >
              Continue with Google
            </button>
          )}
          {methods.magicLink && (
            <Button
              variant="outline"
              size="full"
              loading={loading}
              onClick={() => void handleMagicLink()}
            >
              Send magic link
            </Button>
          )}
        </div>
      </PageShell>
    )
  }

  return (
    <PageShell background="secondary">
      <div className="max-w-[540px] mx-auto py-8 text-center">
        <h1 className="text-xl font-semibold mb-1">Welcome to Claws</h1>
        <p className="text-[13px] text-[var(--tx2)] mb-5">
          Sign in to manage your AI agent teams
        </p>

        {authError === "ConsentRequired" ? (
          <AlertBanner variant="error">
            <span><strong>Consent required.</strong> Please accept the Terms and Privacy Policy below before signing up.</span>
          </AlertBanner>
        ) : authError ? (
          <AlertBanner variant="error">
            <span><strong>Authentication failed.</strong> Please try again or use a different method.</span>
          </AlertBanner>
        ) : null}

        {magicLinkSent ? (
          <>
            {/* No whitespace-nowrap: the single-line banner overflowed the
                540px column (founder screenshot, Aug-25). Wrap + left-align. */}
            <AlertBanner variant="info" icon={<Mail className="w-4 h-4" />}>
              <p className="text-left"><strong>Check your email.</strong> We sent a magic link to {email}. Click it to sign in.</p>
            </AlertBanner>
            {magicLinkError && (
              <AlertBanner variant="error">
                <span>{magicLinkError}</span>
              </AlertBanner>
            )}
            <div className="flex items-center justify-center gap-4 mt-1">
              <button
                type="button"
                onClick={handleMagicLink}
                disabled={loading}
                className="text-[12px] text-[var(--ac-text)] hover:text-[var(--tx)] underline-offset-2 hover:underline bg-transparent border-0 p-0 cursor-pointer disabled:opacity-50"
              >
                {loading ? "Sending..." : "Didn't get it? Send again"}
              </button>
              <button
                type="button"
                onClick={() => { setMagicLinkSent(false); setMagicLinkError(null) }}
                className="text-[12px] text-[var(--tx3)] hover:text-[var(--tx)] underline-offset-2 hover:underline bg-transparent border-0 p-0 cursor-pointer"
              >
                Use a different email
              </button>
            </div>
          </>
        ) : (
          <>
            <label className="flex items-start gap-2 mb-3 text-left cursor-pointer select-none">
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={(e) => setConsentCookie(e.target.checked)}
                className="mt-[2px] h-[14px] w-[14px] shrink-0 cursor-pointer accent-[var(--ac)]"
                aria-label={SIGNUP_CONSENT_LABEL}
              />
              <span className="text-[12px] text-[var(--tx2)]">
                I agree to the{" "}
                <a href={LEGAL_URLS.terms} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 text-[var(--ac-text)] hover:text-[var(--tx)]">
                  Terms
                </a>{" "}
                and{" "}
                <a href={LEGAL_URLS.privacy} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 text-[var(--ac-text)] hover:text-[var(--tx)]">
                  Privacy Policy
                </a>
              </span>
            </label>
            <button
              onClick={() => signIn("github", { callbackUrl: callbackUrl || "/my-claws" })}
              disabled={!consentChecked}
              className="flex items-center justify-center gap-2 w-full py-2.5 border border-[var(--bd)] rounded-lg text-[13px] bg-[var(--bg)] hover:bg-[var(--bg2)] transition-colors cursor-pointer mb-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/></svg>
              Continue with GitHub
            </button>
            <button
              onClick={() => signIn("google", { callbackUrl: callbackUrl || "/my-claws" })}
              disabled={!consentChecked}
              className="flex items-center justify-center gap-2 w-full py-2.5 border border-[var(--bd)] rounded-lg text-[13px] bg-[var(--bg)] hover:bg-[var(--bg2)] transition-colors cursor-pointer mb-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
              Continue with Google
            </button>

            <div className="flex items-center my-3.5">
              <div className="flex-1 h-px bg-[var(--bd)]" />
              <span className="mx-2.5 text-[11px] text-[var(--tx3)]">or</span>
              <div className="flex-1 h-px bg-[var(--bd)]" />
            </div>

            <Input
              variant="auth"
              type="email"
              placeholder="Email address"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setEmailError(null) }}
              onKeyDown={(e) => { if (e.key === "Enter") handleMagicLink() }}
            />
            {emailError && (
              <p className="text-[11px] text-[var(--err)] mt-1 mb-1 text-left">{emailError}</p>
            )}
            {magicLinkError && (
              <AlertBanner variant="error">
                <span>{magicLinkError}</span>
              </AlertBanner>
            )}
            <Button
              variant="primary"
              size="full"
              loading={loading}
              disabled={loading || !email.trim() || !consentChecked}
              onClick={handleMagicLink}
            >
              Send magic link
            </Button>
          </>
        )}
      </div>
    </PageShell>
  )
}
