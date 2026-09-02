"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { DocumentViewer } from "@/components/dashboard/document-viewer"
import { Textarea } from "@/components/ui/textarea"
import { MarkdownBody } from "@/components/dashboard/chat-message"
import { TruncatedText } from "@/components/ui/truncate-with-tooltip"
import { useSnackbarOptional } from "@/components/shared/snackbar"
import { mutateWithFeedback } from "@/lib/ui/mutate-with-feedback"
import { cn } from "@/lib/utils"
import type { DeliverableKind } from "@/lib/artifacts/deliverable-kind"
import {
  messageFromRespondBody,
  type ApprovalDecisionState,
} from "@/lib/artifacts/approval-version"

export interface DocumentCardProps {
  workspaceId: string
  fileVersionId: string
  title: string
  preview: string
  logicalPath: string
  deliverableKind: DeliverableKind
  humanRequestId: string | null
  timestamp: string
  decision?: ApprovalDecisionState
  latestLabel?: string
  stateRevision?: number
  className?: string
  onDecision?: (decision: "APPROVED" | "REJECTED") => void
}

function decisionStatusCopy(
  decision: ApprovalDecisionState,
  latestLabel: string,
): { text: string; className: string } | null {
  if (decision === "APPROVED") {
    return { text: "Approved \u2713", className: "text-[var(--ok)]" }
  }
  if (decision === "REJECTED") {
    return { text: "Rejected", className: "text-[var(--tx2)]" }
  }
  if (decision === "SUPERSEDED") {
    return {
      text: latestLabel ? `Superseded - see ${latestLabel} version` : "Superseded - see latest",
      className: "text-[var(--tx3)]",
    }
  }
  return null
}

export function DocumentCard({
  workspaceId,
  fileVersionId,
  title,
  preview,
  logicalPath,
  deliverableKind,
  humanRequestId,
  timestamp,
  decision: decisionProp,
  latestLabel: latestLabelProp,
  stateRevision = 0,
  className,
  onDecision,
}: DocumentCardProps) {
  const snackbar = useSnackbarOptional()
  const show = snackbar?.show ?? (() => undefined)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [content, setContent] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState<{
    decision: ApprovalDecisionState
    latestLabel: string
  } | null>(null)
  const isDecision = deliverableKind === "decision"
  const decision = decisionProp ?? fetched?.decision ?? null
  const latestLabel = latestLabelProp ?? fetched?.latestLabel ?? ""

  useEffect(() => {
    if (decisionProp !== undefined) return
    let cancelled = false
    void fetch(`/api/workspaces/${workspaceId}/file-versions/${fileVersionId}`)
      .then(async (res) => {
        if (!res.ok) return
        const json = (await res.json()) as {
          data?: { decision?: ApprovalDecisionState; latestLabel?: string }
        }
        if (cancelled || !json.data?.decision) return
        setFetched({
          decision: json.data.decision,
          latestLabel: json.data.latestLabel ?? "",
        })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [workspaceId, fileVersionId, stateRevision, decisionProp])

  const loadContent = async () => {
    const res = await fetch(`/api/workspaces/${workspaceId}/file-versions/${fileVersionId}`)
    if (!res.ok) throw new Error("Could not open document")
    const json = (await res.json()) as {
      data?: {
        content?: string
        decision?: ApprovalDecisionState
        latestLabel?: string
      }
    }
    const next = json.data?.content ?? ""
    setContent(next)
    setDraft(next)
    if (json.data?.decision) {
      setFetched({
        decision: json.data.decision,
        latestLabel: json.data.latestLabel ?? "",
      })
    }
  }

  const handleOpen = async () => {
    setOpen(true)
    if (content !== null) return
    try {
      await loadContent()
    } catch (err) {
      show({
        message: err instanceof Error ? err.message : "Could not open document",
        variant: "error",
      })
      setOpen(false)
    }
  }

  const respond = async (action: "approve" | "reject") => {
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
              fileVersionId,
              activityLogId: humanRequestId ?? undefined,
            }),
          })
          if (!res.ok) {
            const body: unknown = await res.json().catch(() => null)
            throw new Error(messageFromRespondBody(body, fallback))
          }
          const next = action === "approve" ? "APPROVED" : "REJECTED"
          setFetched({ decision: next, latestLabel })
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

  const saveEdit = async () => {
    setLoading(true)
    try {
      await mutateWithFeedback(
        async () => {
          const res = await fetch(`/api/workspaces/${workspaceId}/file-versions/${fileVersionId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: draft }),
          })
          if (!res.ok) throw new Error("Could not save edit")
          setContent(draft)
          setEditing(false)
        },
        { message: "Document updated", errorMessage: "Could not save edit" },
        show,
      )
    } catch {
      /* snackbar already shown */
    } finally {
      setLoading(false)
    }
  }

  const status = decision ? decisionStatusCopy(decision, latestLabel) : null
  const showButtons = isDecision && decision === "NONE"

  return (
    <div className={cn("self-start w-full max-w-[85%]", className)}>
      <div
        className={cn(
          "rounded-[10px] border border-[var(--bd)] bg-[var(--bg)] px-[12px] py-[10px]",
          "hover:border-[var(--ac)] transition-colors",
        )}
      >
        <div className="flex items-start justify-between gap-[10px]">
          <div className="min-w-0">
            <TruncatedText as="p" className="text-[13px] font-semibold text-[var(--tx)]">
              {title}
            </TruncatedText>
            <p className="mt-[3px] text-[10px] text-[var(--tx3)]">{timestamp}</p>
            {preview && (
              // truncate-allowlist: 3-line card preview; TruncatedText is single-line only
              <p className="mt-[6px] line-clamp-3 text-[12px] leading-snug text-[var(--tx2)]">{preview}</p>
            )}
          </div>
          <Button variant="outline" size="xs" onClick={() => void handleOpen()}>
            Open
          </Button>
        </div>
        {showButtons && (
          <div className="mt-[8px] flex items-center gap-[4px]" data-testid="document-card-actions">
            <Button
              variant="primary"
              className="text-[9px] px-[8px] py-[2px] h-auto"
              disabled={loading}
              loading={loading}
              onClick={() => void respond("approve")}
            >
              Approve
            </Button>
            <Button
              variant="outline"
              className="text-[9px] px-[8px] py-[2px] h-auto"
              disabled={loading}
              onClick={() => {
                void handleOpen().then(() => setEditing(true))
              }}
            >
              Edit
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
        {status && (
          <p className={cn("mt-[8px] text-[11px] font-medium", status.className)} data-testid="document-card-status">
            {status.text}
          </p>
        )}
      </div>

      <DocumentViewer
        open={open}
        onClose={() => {
          setOpen(false)
          setEditing(false)
        }}
        title={title}
        description={logicalPath}
        actions={
          showButtons ? (
            editing ? (
              <>
                <Button variant="outline" size="sm" onClick={() => setEditing(false)} disabled={loading}>
                  Cancel
                </Button>
                <Button variant="primary" size="sm" onClick={() => void saveEdit()} loading={loading}>
                  Save
                </Button>
              </>
            ) : (
              <>
                <Button variant="outline" size="sm" onClick={() => setEditing(true)} disabled={loading}>
                  Edit
                </Button>
                <Button variant="outline" size="sm" onClick={() => void respond("reject")} disabled={loading}>
                  Reject
                </Button>
                <Button variant="primary" size="sm" onClick={() => void respond("approve")} loading={loading}>
                  Approve
                </Button>
              </>
            )
          ) : undefined
        }
      >
        {content === null ? (
          <p className="text-[12px] text-[var(--tx3)]">Loading...</p>
        ) : editing ? (
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="min-h-[160px] w-full max-w-full text-[12px] font-mono"
          />
        ) : (
          <MarkdownBody content={content} />
        )}
      </DocumentViewer>
    </div>
  )
}
