"use client"

import { useMemo, useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { signIn } from "next-auth/react"
import { PageShell } from "@/components/shared/page-shell"
import { PageHeader } from "@/components/shared/page-header"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { AlertBanner } from "@/components/ui/alert-banner"

function strengthHint(password: string): string {
  if (password.length === 0) return "At least 12 characters."
  if (password.length < 12) return "Too short. Use at least 12 characters."
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((pattern) => pattern.test(password)).length
  if (password.length >= 16 && kinds >= 3) return "Strong password."
  if (kinds >= 2) return "Okay password. Longer is better."
  return "Weak password. Add mixed characters."
}

export default function CreateOwnerPage() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const hint = useMemo(() => strengthHint(password), [password])

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    if (!email.includes("@")) {
      setError("A valid email is required")
      return
    }
    if (password.length < 12 || password.length > 200) {
      setError("Password must be 12–200 characters")
      return
    }
    if (password !== confirm) {
      setError("Passwords do not match")
      return
    }
    setLoading(true)
    const res = await fetch("/api/setup/owner", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), password }),
    })
    const json = (await res.json().catch(() => null)) as { error?: { message?: string } } | null
    if (!res.ok) {
      setLoading(false)
      setError(json?.error?.message ?? "Could not create the owner account")
      return
    }
    const signedIn = await signIn("credentials", {
      email: email.trim(),
      password,
      callbackUrl: "/store",
      redirect: false,
    })
    setLoading(false)
    if (signedIn?.error) {
      setError("Account created, but sign-in failed. Open the sign-in page and try again.")
      return
    }
    router.push("/store")
  }

  return (
    <PageShell background="secondary">
      <div className="max-w-[420px] mx-auto py-8">
        <Card>
          <PageHeader title="Create your owner account" />
          <form onSubmit={(event) => void onSubmit(event)}>
            {error && (
              <AlertBanner variant="error">
                <span>{error}</span>
              </AlertBanner>
            )}
            <Input
              variant="auth"
              type="email"
              placeholder="Email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-label="Email"
            />
            <Input
              variant="auth"
              type="password"
              placeholder="Password"
              autoComplete="new-password"
              minLength={12}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-label="Password"
            />
            <p className="text-[11px] text-[var(--tx3)] -mt-1 mb-2 text-left">{hint}</p>
            <Input
              variant="auth"
              type="password"
              placeholder="Confirm password"
              autoComplete="new-password"
              minLength={12}
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              aria-label="Confirm password"
            />
            <Button variant="primary" size="full" type="submit" loading={loading}>
              Create account
            </Button>
          </form>
        </Card>
      </div>
    </PageShell>
  )
}
