"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { Textarea } from "@/components/ui/textarea"
import { MarkdownBody } from "@/components/dashboard/chat-message"
import { useSnackbarOptional } from "@/components/shared/snackbar"
import { mutateWithFeedback } from "@/lib/ui/mutate-with-feedback"
import { cn } from "@/lib/utils"
import type { DeliverableKind } from "@/lib/artifacts/deliverable-kind"

export interface DocumentCardProps {
  workspaceId: string
  fileVersionId: string
  title: string
  preview: string
  logicalPath: string
  deliverableKind: DeliverableKind
  humanRequestId: string | null
  timestamp: string
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
}: DocumentCardProps) {
  const snackbar = useSnackbarOptional()
  const show = snackbar?.show ?? (() => undefined)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [content, setContent] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [loading, setLoading] = useState(false)
  const [decision, setDecision] = useState<"NONE" | "APPROVED" | "REJECTED">("NONE")
  const isDecision = deliverableKind === "decision"

  const loadContent = async () => {
    const res = await fetch(`/api/workspaces/${workspaceId}/file-versions/${fileVersionId}`)
    if (!res.ok) throw new Error("Could not open document")
    const json = (await res.json()) as {
      data?: { content?: string; decision?: "NONE" | "APPROVED" | "REJECTED" }
    }
    const next = json.data?.content ?? ""
    setContent(next)
    setDraft(next)
    if (json.data?.decision) setDecision(json.data.decision)
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
          if (!res.ok) throw new Error(action === "approve" ? "Could not approve" : "Could not reject")
          setDecision(action === "approve" ? "APPROVED" : "REJECTED")
        },
        {
          message: action === "approve" ? "Approved" : "Rejected",
          errorMessage: action === "approve" ? "Could not approve" : "Could not reject",
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

  return (
    <div className="self-start w-full max-w-[85%]">
      <div
        className={cn(
          "rounded-[10px] border border-[var(--bd)] bg-[var(--bg)] px-[12px] py-[10px]",
          "hover:border-[var(--ac)] transition-colors",
        )}
      >
        <div className="flex items-start justify-between gap-[10px]">
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-[var(--tx)]">{title}</p>
            <p className="mt-[3px] text-[10px] text-[var(--tx3)]">
              {timestamp}
              {decision !== "NONE" ? ` · ${decision === "APPROVED" ? "Approved" : "Rejected"}` : ""}
            </p>
            {preview && (
              <p className="mt-[6px] line-clamp-3 text-[12px] leading-snug text-[var(--tx2)]">{preview}</p>
            )}
          </div>
          <Button variant="outline" size="xs" onClick={() => void handleOpen()}>
            Open
          </Button>
        </div>
        {isDecision && decision === "NONE" && (
          <div className="mt-[8px] flex items-center gap-[4px]">
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
      </div>

      <Modal
        open={open}
        onClose={() => {
          setOpen(false)
          setEditing(false)
        }}
        title={title}
        description={logicalPath}
        size="xl"
        footer={
          isDecision && decision === "NONE" ? (
            <div className="flex items-center justify-end gap-[6px]">
              {editing ? (
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
              )}
            </div>
          ) : undefined
        }
      >
        {content === null ? (
          <p className="text-[12px] text-[var(--tx3)]">Loading...</p>
        ) : editing ? (
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="min-h-[280px] text-[12px] font-mono"
          />
        ) : (
          <MarkdownBody content={content} />
        )}
      </Modal>
    </div>
  )
}
