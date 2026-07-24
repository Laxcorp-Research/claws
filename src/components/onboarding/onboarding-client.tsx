"use client"

import { useCallback, useState } from "react"
import { useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import Link from "next/link"
import { PageShell } from "@/components/shared/page-shell"
import { Button } from "@/components/ui/button"
import { OnboardingStep } from "@/components/onboarding/onboarding-step"
import { OnboardingJwtRefresh } from "@/components/onboarding/onboarding-jwt-refresh"
import { useSnackbarOptional } from "@/components/shared/snackbar"
import { TextLink } from "@/components/ui/text-link"
import { StatusBadge } from "@/components/ui/status-badge"
import { mutateWithFeedback } from "@/lib/ui/mutate-with-feedback"
import { mapWorkspaceStatus } from "@/lib/utils"
import {
  resolveStep3Action,
  workspaceContinueHref,
  type TrackerState,
  type TrackerWorkspace,
} from "@/lib/onboarding/tracker-state"

const ANTHROPIC_TEMPLATE_HINT =
  "Templates are engineered for Claude models — add an Anthropic key, or switch individual agents' models in the builder."

const NEED_CLAW_SNACKBAR =
  "Create a Claw first — tools and deployment live in its setup wizard"

export interface OnboardingClientProps {
  mode: "gate" | "revisit"
  state: TrackerState
  workspaces: TrackerWorkspace[]
}

export function OnboardingClient({ mode, state, workspaces }: OnboardingClientProps) {
  const router = useRouter()
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
  const [emphasizeStep2, setEmphasizeStep2] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)

  const markComplete = async (): Promise<void> => {
    const res = await fetch("/api/user/complete-onboarding", { method: "POST" })
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as {
        error?: { message?: string }
      } | null
      throw new Error(data?.error?.message || "Could not complete onboarding")
    }
    await update({ onboardingCompleted: true }).catch(() => null)
  }

  const handleSkip = async () => {
    if (mode !== "gate" || isSkipping || isCreating) return
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

  const handleStep3 = () => {
    const action = resolveStep3Action({
      s2Done: state.s2Done,
      s3Done: state.s3Done,
      workspaces,
      deployedWorkspaceId: state.deployedWorkspaceId,
    })
    if (action.type === "need-claw") {
      showSnackbar({ message: NEED_CLAW_SNACKBAR, variant: "error" })
      setEmphasizeStep2(true)
      window.setTimeout(() => setEmphasizeStep2(false), 1600)
      return
    }
    if (action.type === "direct" || action.type === "dashboard") {
      router.push(action.href)
      return
    }
    setPickerOpen(true)
  }

  const headerTitle = state.allDone ? "You're all set" : "Getting started"
  const headerSub = state.allDone
    ? "Your keys, Claws, and first deploy are in place. Revisit anytime from the menu."
    : "Track the essentials to get your first AI agent team running."

  return (
    <PageShell background="secondary">
      <OnboardingJwtRefresh enabled={mode === "revisit"} />
      <div className="max-w-xl mx-auto py-6 text-center">
        <h1 className="text-2xl font-semibold mb-1">{headerTitle}</h1>
        <p className="text-sm text-[var(--tx2)] mb-5">{headerSub}</p>

        <div className="flex flex-col gap-3 mb-4">
          <OnboardingStep
            number={1}
            title="Add your AI model key"
            description="Your agents need an AI model to think. We support Anthropic, OpenAI, and Google."
            completed={state.s1Done}
            actions={
              !state.s1Done ? (
                <>
                  <Link href="/settings?tab=api-keys">
                    <Button variant="primary" size="sm">Add Anthropic key</Button>
                  </Link>
                  <Link href="/settings?tab=api-keys">
                    <Button variant="outline" size="sm">Add OpenAI key</Button>
                  </Link>
                </>
              ) : state.showAnthropicTemplateHint ? (
                <>
                  <p className="text-[11px] text-[var(--tx2)] text-left mb-1 max-w-md w-full">
                    {ANTHROPIC_TEMPLATE_HINT}
                  </p>
                  <p className="text-[11px] text-[var(--tx2)] w-full text-left">
                    Connected: {state.connectedProviders.join(", ")}
                  </p>
                  <Link href="/settings?tab=api-keys">
                    <Button variant="primary" size="sm">Add Anthropic key</Button>
                  </Link>
                  <TextLink href="/settings?tab=api-keys" direction="forward">
                    Manage keys
                  </TextLink>
                </>
              ) : (
                <>
                  <p className="text-[11px] text-[var(--tx2)] w-full text-left">
                    Connected: {state.connectedProviders.join(", ")}
                  </p>
                  <TextLink href="/settings?tab=api-keys" direction="forward">
                    Manage keys
                  </TextLink>
                </>
              )
            }
          />

          <OnboardingStep
            number={2}
            title="Pick your first Claw"
            description="Choose a pre-built team or create your own from scratch."
            completed={state.s2Done}
            emphasized={emphasizeStep2}
            actions={
              !state.s2Done ? (
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
              ) : (
                <>
                  <p className="text-[11px] text-[var(--tx2)] w-full text-left">
                    {state.workspaceCount === 1
                      ? "1 Claw created"
                      : `${state.workspaceCount} Claws created`}
                  </p>
                  <TextLink href="/my-claws" direction="forward">
                    My Claws
                  </TextLink>
                </>
              )
            }
          />

          <OnboardingStep
            number={3}
            title="Connect tools & deploy"
            description="Open a Claw's setup wizard to connect tools and deploy. Once deployed, it stays checked even if the Claw is later stopped."
            completed={state.s3Done}
            actions={
              state.s3Done && state.deployedWorkspaceId ? (
                <TextLink
                  href={`/dashboard/${state.deployedWorkspaceId}`}
                  direction="forward"
                >
                  Open dashboard
                </TextLink>
              ) : (
                <Button variant="primary" size="sm" onClick={handleStep3}>
                  {state.s2Done ? "Continue setup" : "Connect tools & deploy"}
                </Button>
              )
            }
          >
            {pickerOpen && !state.s3Done && workspaces.length > 1 && (
              <ul className="border border-[var(--bd)] rounded-xl overflow-hidden text-left">
                {workspaces.map((w) => (
                  <li key={w.id} className="border-b border-[var(--bd)] last:border-b-0">
                    <button
                      type="button"
                      className="w-full flex items-center justify-between gap-2 px-3 py-2.5 bg-transparent hover:bg-[var(--bg2)] cursor-pointer text-left"
                      onClick={() => router.push(workspaceContinueHref(w))}
                    >
                      <span className="text-[12px] font-medium text-[var(--tx)] truncate">
                        {w.name}
                      </span>
                      <StatusBadge status={mapWorkspaceStatus(w.status)} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </OnboardingStep>
        </div>

        {mode === "gate" && (
          <TextLink
            direction="forward"
            onClick={handleSkip}
            disabled={isSkipping || isCreating || status === "loading"}
          >
            {isSkipping ? "Leaving..." : "Skip onboarding"}
          </TextLink>
        )}
      </div>
    </PageShell>
  )
}
