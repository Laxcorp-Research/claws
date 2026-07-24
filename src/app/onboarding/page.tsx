import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { loadOnboardingGate } from "@/lib/auth/onboarding-gate"
import { loadGettingStartedTracker } from "@/lib/onboarding/load-tracker"
import { OnboardingClient } from "@/components/onboarding/onboarding-client"

export default async function OnboardingPage() {
  const session = await getServerSession(authOptions)
  const gate = await loadOnboardingGate(session?.user?.id)

  if (gate.redirectTo === "/auth/signin" || !session?.user?.id) {
    redirect("/auth/signin")
  }

  const tracker = await loadGettingStartedTracker(session.user.id)
  if (!tracker) {
    redirect("/auth/signin")
  }

  // Gate incomplete → tracker in gate mode (Skip visible).
  // DB-complete → revisit mode (no redirect away). Proxy allowlists /onboarding
  // so a stale-false JWT cannot bounce-loop; OnboardingJwtRefresh re-issues cookie.
  return (
    <OnboardingClient
      mode={tracker.mode}
      state={tracker.state}
      workspaces={tracker.workspaces}
    />
  )
}
