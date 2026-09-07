"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { useSnackbarOptional } from "@/components/shared/snackbar"
import { mutateWithFeedback } from "@/lib/ui/mutate-with-feedback"
import { cn } from "@/lib/utils"
import { messageFromRespondBody } from "@/lib/artifacts/approval-version"
import {
  httpActionCardViolations,
  isHttpActionCardRenderable,
  type HttpActionCardView,
} from "@/lib/openclaw/http-action-card"

export interface HttpActionCardProps {
  workspaceId: string
  humanRequestId: string
  timestamp: string
  card: HttpActionCardView
  decision?: "NONE" | "APPROVED" | "REJECTED" | "SUPERSEDED"
  className?: string
  onDecision?: (decision: "APPROVED" | "REJECTED") => void
}

export function HttpActionCard({
  workspaceId,
  humanRequestId,
  timestamp,
  card,
  decision = "NONE",
  className,
  onDecision,
}: HttpActionCardProps) {
  const snackbar = useSnackbarOptional()
  const show = snackbar?.show ?? (() => undefined)
  const [loading, setLoading] = useState(false)
  const [localDecision, setLocalDecision] = useState(decision)
  const violations = httpActionCardViolations(card)
  const renderable = isHttpActionCardRenderable(card)
  const showButtons = localDecision === "NONE"

  const respond = async (action: "approve" | "reject") => {
    if (action === "approve" && !renderable) return
    setLoading(true)
    const fallback = action === "approve" ? "Could not approve" : "Could not reject"
    try {
      await mutateWithFeedback(
        async () => {
          const res = await fetch(`/api/workspaces/${workspaceId}/respond`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action,
              activityLogId: humanRequestId,
            }),
          })
          if (!res.ok) {
            const body: unknown = await res.json().catch(() => null)
            throw new Error(messageFromRespondBody(body, fallback))
          }
          const next = action === "approve" ? "APPROVED" : "REJECTED"
          setLocalDecision(next)
          onDecision?.(next)
        },
        {
          message: action === "approve" ? "Approved" : "Rejected",
        },
        show,
      )
    } catch {
      /* snackbar already shown */
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={cn("self-start w-full max-w-[85%]", className)}>
      <div
        className={cn(
          "rounded-[10px] border border-[var(--bd)] bg-[var(--bg)] px-[12px] py-[10px]",
          "hover:border-[var(--ac)] transition-colors",
        )}
        data-testid="http-action-card"
      >
        <p className="text-[13px] font-semibold text-[var(--tx)]">HTTP ACTION</p>
        <p className="mt-[3px] text-[10px] text-[var(--tx3)]">{timestamp}</p>
        <dl className="mt-[6px] grid gap-[4px] text-[12px] leading-snug text-[var(--tx2)]">
          <div>
            <dt className="text-[10px] uppercase tracking-[0.04em] text-[var(--tx3)]">Skill</dt>
            <dd className="text-[var(--tx)]">{card.skill || "—"}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-[0.04em] text-[var(--tx3)]">Method</dt>
            <dd className="text-[var(--tx)]">{card.method || "—"}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-[0.04em] text-[var(--tx3)]">Host</dt>
            <dd className="text-[var(--tx)]">{card.host || "—"}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-[0.04em] text-[var(--tx3)]">Path</dt>
            <dd className="text-[var(--tx)]">{card.path || "—"}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-[0.04em] text-[var(--tx3)]">Body</dt>
            <dd className="whitespace-pre-wrap text-[var(--tx)]" data-testid="http-action-body">
              {card.bodyPlain || "missing"}
            </dd>
          </div>
        </dl>
        {!renderable && (
          <p className="mt-[8px] text-[11px] text-[var(--err)]" data-testid="http-action-violations">
            Action payload missing — cannot approve ({violations.join(", ")})
          </p>
        )}
        {showButtons && (
          <div className="mt-[8px] flex items-center gap-[4px]" data-testid="http-action-card-actions">
            <Button
              variant="primary"
              className="text-[9px] px-[8px] py-[2px] h-auto"
              disabled={loading || !renderable}
              loading={loading}
              onClick={() => void respond("approve")}
            >
              Approve
            </Button>
            <Button
              variant="outline"
              className="text-[9px] px-[8px] py-[2px] h-auto"
              disabled={loading}
              onClick={() => void respond("reject")}
            >
              Reject
            </Button>
          </div>
        )}
        {localDecision === "APPROVED" && (
          <p className="mt-[8px] text-[11px] font-medium text-[var(--ok)]">Approved ✓</p>
        )}
        {localDecision === "REJECTED" && (
          <p className="mt-[8px] text-[11px] font-medium text-[var(--tx2)]">Rejected</p>
        )}
      </div>
    </div>
  )
}
