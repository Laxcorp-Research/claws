"use client"

import { useEffect, useRef } from "react"
import { useSession } from "next-auth/react"

/**
 * When DB onboarding is complete but the JWT claim may still be false,
 * re-issue the cookie without navigating away (revisit mode stays on
 * /onboarding). Proxy allowlists /onboarding so there is no bounce loop;
 * this unlocks gated routes like /my-claws afterward.
 */
export function OnboardingJwtRefresh({ enabled }: { enabled: boolean }) {
  const { data, update, status } = useSession()
  const ran = useRef(false)

  useEffect(() => {
    if (!enabled || status === "loading" || ran.current) return
    if (data?.onboardingCompleted === true) return
    ran.current = true
    void (async () => {
      const res = await fetch("/api/user/complete-onboarding", { method: "POST" }).catch(() => null)
      if (!res?.ok) return
      await update({ onboardingCompleted: true }).catch(() => null)
    })()
  }, [enabled, status, data?.onboardingCompleted, update])

  return null
}
