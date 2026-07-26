"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { Button } from "@/components/ui/button"

/**
 * Escape hatch when the DB flag is already true but the JWT claim is still
 * false. A server redirect() to /my-claws would loop with the edge guard
 * (proxy reads the cookie, not the DB). Re-issue the JWT via the complete-
 * onboarding route, then hard-nav.
 */
export function OnboardingSessionSync({ target }: { target: string }) {
  const { update, status } = useSession()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const syncAndGo = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/user/complete-onboarding", { method: "POST" })
      if (!res.ok) throw new Error("Could not refresh session")
      await update({ onboardingCompleted: true }).catch(() => null)
      window.location.replace(target)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not refresh session")
      setBusy(false)
    }
  }

  useEffect(() => {
    if (status === "loading") return
    void syncAndGo()
    // Intentionally once when session settles.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  return (
    <div className="max-w-md mx-auto py-16 text-center">
      <p className="text-sm text-[var(--tx2)] mb-3">
        {busy || status === "loading" ? "Finishing setup…" : "Ready to continue."}
      </p>
      {error && (
        <>
          <p className="text-[12px] text-[var(--err)] mb-3">{error}</p>
          <Button variant="primary" size="sm" onClick={() => void syncAndGo()} loading={busy}>
            Retry
          </Button>
        </>
      )}
    </div>
  )
}
