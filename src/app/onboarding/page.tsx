"use client"

import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import { PageShell } from "@/components/shared/page-shell"
import { Button } from "@/components/ui/button"
import { OnboardingStep } from "@/components/onboarding/onboarding-step"
import Link from "next/link"

export default function OnboardingPage() {
  const router = useRouter()
  const { update } = useSession()

  const handleSkip = async () => {
    await fetch("/api/user/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ onboardingCompleted: true }),
    }).catch(() => {})
    await update({ onboardingCompleted: true }).catch(() => {})
    router.push("/my-claws")
  }

  return (
    <PageShell background="secondary">
      <div className="max-w-xl mx-auto py-6 text-center">
        <h1 className="text-2xl font-semibold mb-1">Welcome to Claws</h1>
        <p className="text-sm text-[var(--tx2)] mb-5">
          Let&apos;s get your first AI agent team running.
        </p>

        <div className="flex flex-col gap-3 mb-4">
          <OnboardingStep
            number={1}
            title="Add your AI model key"
            description="Your agents need an AI model to think. We support Anthropic, OpenAI, and Google."
            actions={
              <>
                <Button variant="primary" size="sm">Add Anthropic key</Button>
                <Button variant="outline" size="sm">Add OpenAI key</Button>
              </>
            }
          />
          <OnboardingStep
            number={2}
            title="Pick your first Claw"
            description="Choose a pre-built team or create your own from scratch."
            actions={
              <>
                <Link href="/store"><Button variant="primary" size="sm">Browse the store</Button></Link>
                <Button variant="outline" size="sm">Create custom Claw</Button>
              </>
            }
          />
          <OnboardingStep
            number={3}
            title="Connect tools & deploy"
            description="The setup wizard guides you through connecting your tools and deploying your agents."
            disabled
          />
        </div>

        <button onClick={handleSkip} className="text-[11px] text-[var(--ac)] hover:text-[var(--tx)] hover:underline cursor-pointer transition-colors">
          Skip onboarding →
        </button>
      </div>
    </PageShell>
  )
}
