"use client"

import { useState, useCallback } from "react"
import { useSession } from "next-auth/react"
import Link from "next/link"
import { PageShell } from "@/components/shared/page-shell"
import { Button } from "@/components/ui/button"
import { OnboardingStep } from "@/components/onboarding/onboarding-step"
import { useSnackbarOptional } from "@/components/shared/snackbar"
import { TextLink } from "@/components/ui/text-link"
import { mutateWithFeedback } from "@/lib/ui/mutate-with-feedback"

interface OnboardingClientProps {
  /** Server-derived: true when the user already has at least one UserApiKey. */
  hasApiKey: boolean
  /**
   * D-iii COPY-HONESTY: user has another provider key but no Anthropic key.
   * Templates are engineered for Claude — no remap assist.
   */
  showAnthropicTemplateHint?: boolean
}

const ANTHROPIC_TEMPLATE_HINT =
  "Templates are engineered for Claude models — add an Anthropic key, or switch individual agents' models in the builder."

export function OnboardingClient({
  hasApiKey,
  showAnthropicTemplateHint = false,
}: OnboardingClientProps) {
  const { update, status } = useSession()
  const snackbar = useSnackbarOptional()
  const showSnackbar = useCallback(
    (options: Parameters<NonNullable<typeof snackbar>["show"]>[0]) => {
      snackbar?.show(options)
    },
    [snackbar],
  )
  const [isCreating, setIsCreating] = useState(false)
  const [isSkipping, setIsSkipping] = useState(false)

  /**
   * Persist DB flag + re-issue JWT via dedicated route (authoritative).
   * Also call useSession().update so client state matches before hard-nav.
   */
  const markComplete = async (): Promise<void> => {
    const res = await fetch("/api/user/complete-onboarding", { method: "POST" })
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as {
        error?: { message?: string }
      } | null
      throw new Error(data?.error?.message || "Could not complete onboarding")
    }
    // Best-effort client sync; cookie was already Set-Cookie'd by the route.
    await update({ onboardingCompleted: true }).catch(() => null)
  }

  const handleSkip = async () => {
    if (isSkipping || isCreating) return
    setIsSkipping(true)
    try {
      await mutateWithFeedback(
        async () => {
          await markComplete()
          window.location.assign("/my-claws")
        },
        {
          message: "Onboarding skipped",
          errorMessage: "Could not leave onboarding. Try again.",
        },
        showSnackbar,
      )
    } catch {
      /* snackbar already shown */
    } finally {
      setIsSkipping(false)
    }
  }

  const handleCreateCustomClaw = async () => {
    if (isCreating || isSkipping) return
    setIsCreating(true)
    try {
      await mutateWithFeedback(
        async () => {
          const res = await fetch("/api/workspaces", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "My Claw 1" }),
            signal: AbortSignal.timeout(15_000),
          })
          const data = (await res.json().catch(() => null)) as {
            data?: { id?: string }
            id?: string
            error?: { message?: string }
          } | null
          if (!res.ok) {
            throw new Error(data?.error?.message || "Failed to create workspace")
          }
          const workspaceId = data?.data?.id || data?.id
          if (!workspaceId) throw new Error("No workspace ID returned")
          await markComplete()
          window.location.assign(`/builder/${workspaceId}`)
        },
        {
          message: "Claw created",
          errorMessage: "Could not create Claw. Try again.",
        },
        showSnackbar,
      )
    } catch {
      /* snackbar already shown */
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
            completed={hasApiKey}
            actions={
              !hasApiKey ? (
                <>
                  <Link href="/settings?tab=api-keys">
                    <Button variant="primary" size="sm">Add Anthropic key</Button>
                  </Link>
                  <Link href="/settings?tab=api-keys">
                    <Button variant="outline" size="sm">Add OpenAI key</Button>
                  </Link>
                </>
              ) : showAnthropicTemplateHint ? (
                <>
                  <p className="text-[11px] text-[var(--tx2)] text-left mb-1 max-w-md">
                    {ANTHROPIC_TEMPLATE_HINT}
                  </p>
                  <Link href="/settings?tab=api-keys">
                    <Button variant="primary" size="sm">Add Anthropic key</Button>
                  </Link>
                </>
              ) : undefined
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
                  disabled={isCreating || isSkipping || status === "loading"}
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

        <TextLink
          direction="forward"
          onClick={handleSkip}
          disabled={isSkipping || isCreating || status === "loading"}
        >
          {isSkipping ? "Leaving..." : "Skip onboarding"}
        </TextLink>
      </div>
    </PageShell>
  )
}
