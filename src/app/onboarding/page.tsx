import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { loadOnboardingGate } from "@/lib/auth/onboarding-gate"
import { OnboardingClient } from "@/components/onboarding/onboarding-client"

export default async function OnboardingPage() {
  const session = await getServerSession(authOptions)
  const gate = await loadOnboardingGate(session?.user?.id)

  if (gate.redirectTo) {
    redirect(gate.redirectTo)
  }

  return <OnboardingClient hasApiKey={gate.hasApiKey} />
}
