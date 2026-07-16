"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import Link from "next/link"
import { PageShell } from "@/components/shared/page-shell"
import { Button } from "@/components/ui/button"
import { OnboardingStep } from "@/components/onboarding/onboarding-step"

export default function OnboardingPage() {
  const router = useRouter()
  const { data: session, status, update } = useSession()
  const [isCreating, setIsCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // Returning users (flag true) never see onboarding again.
  useEffect(() => {
    if (status === "authenticated" && session?.onboardingCompleted === true) {
      router.replace("/my-claws")
    }
  }, [status, session?.onboardingCompleted, router])

  const markComplete = async () => {
    await fetch("/api/user/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ onboardingCompleted: true }),
    })
    await update({ onboardingCompleted: true })
  }

  const handleSkip = async () => {
    try {
      await markComplete()
    } catch {
      /* still leave — next visit reloads JWT from DB */
    }
    router.push("/my-claws")
  }

  /** Match My Claws "+ Create custom Claw": POST /api/workspaces → /builder/{id}. */
  const handleCreateCustomClaw = async () => {
    if (isCreating) return
    setIsCreating(true)
    setCreateError(null)
    try {
      const res = await fetch("/api/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "My Claw 1" }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data?.error?.message || "Failed to create workspace")
      const workspaceId = data.data?.id || data.id
      if (!workspaceId) throw new Error("No workspace ID returned")
      await markComplete().catch(() => {})
      router.push(`/builder/${workspaceId}`)
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Failed to create workspace")
    } finally {
      setIsCreating(false)
    }
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
                <Link href="/settings?tab=api-keys">
                  <Button variant="primary" size="sm">Add Anthropic key</Button>
                </Link>
                <Link href="/settings?tab=api-keys">
                  <Button variant="outline" size="sm">Add OpenAI key</Button>
                </Link>
              </>
            }
          />
          <OnboardingStep
            number={2}
            title="Pick your first Claw"
            description="Choose a pre-built team or create your own from scratch."
            actions={
              <>
                <Link href="/store">
                  <Button variant="primary" size="sm">Browse the store</Button>
                </Link>
                <Button
                  variant="outline"
                  size="sm"
                  loading={isCreating}
                  onClick={handleCreateCustomClaw}
                >
                  {isCreating ? "Creating..." : "Create custom Claw"}
                </Button>
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

        {createError && (
          <p className="text-[12px] text-[var(--err)] mb-2">{createError}</p>
        )}

        <button
          type="button"
          onClick={handleSkip}
          className="text-[11px] text-[var(--ac-text)] hover:text-[var(--tx)] hover:underline cursor-pointer transition-colors bg-transparent border-0"
        >
          Skip onboarding →
        </button>
      </div>
    </PageShell>
  )
}
