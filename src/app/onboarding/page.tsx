import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { loadOnboardingGate } from "@/lib/auth/onboarding-gate"
import { OnboardingClient } from "@/components/onboarding/onboarding-client"
import { OnboardingSessionSync } from "@/components/onboarding/onboarding-session-sync"
import { PageShell } from "@/components/shared/page-shell"

export default async function OnboardingPage() {
  const session = await getServerSession(authOptions)
  const gate = await loadOnboardingGate(session?.user?.id)

  if (gate.redirectTo === "/auth/signin") {
    redirect("/auth/signin")
  }

  // DB-complete + possibly stale-false JWT: do NOT server-redirect to /my-claws
  // (proxy would bounce back → loop). Sync the JWT client-side first.
  if (gate.redirectTo === "/my-claws") {
    return (
      <PageShell background="secondary">
        <OnboardingSessionSync target="/my-claws" />
      </PageShell>
    )
  }

  return (
    <OnboardingClient
      hasApiKey={gate.hasApiKey}
      showAnthropicTemplateHint={gate.showAnthropicTemplateHint}
    />
  )
}
