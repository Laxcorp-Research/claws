"use client"

import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { Modal } from "@/components/ui/modal"
import { Textarea } from "@/components/ui/textarea"
import { TruncatedText } from "@/components/ui/truncate-with-tooltip"
import { MarkdownBody } from "@/components/dashboard/chat-message"
import { useSnackbarOptional } from "@/components/shared/snackbar"
import { mutateWithFeedback } from "@/lib/ui/mutate-with-feedback"
import {
  agentLabelFromMemoryPath,
  type CatalogFile,
  type FileDetail,
  type FileHistoryRow,
} from "@/lib/artifacts/files-catalog"

type CatalogResponse = {
  files?: CatalogFile[]
  snapshotAsOf?: string | null
}

function formatWhen(iso: string | null): string {
  if (!iso) return "birth stub"
  const parsed = Date.parse(iso)
  if (Number.isNaN(parsed)) return iso
  return new Date(parsed).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }) + " UTC"
}

function FileRow({
  file,
  onOpen,
}: {
  file: CatalogFile
  onOpen: (file: CatalogFile) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(file)}
      className="w-full rounded-[10px] border border-[var(--bd)] bg-[var(--bg)] px-[12px] py-[10px] text-left hover:border-[var(--ac)] transition-colors"
    >
      <div className="flex items-start justify-between gap-[10px]">
        <div className="min-w-0">
          <TruncatedText as="p" className="text-[13px] font-semibold text-[var(--tx)]">
            {file.logicalPath}
          </TruncatedText>
          <p className="mt-[3px] text-[10px] text-[var(--tx3)]">
            {file.owner === "agent" ? `${agentLabelFromMemoryPath(file.logicalPath)} · ` : ""}
            {file.latestVersion ? `v${file.latestVersion} · ` : ""}
            {formatWhen(file.updatedAt)}
            {file.editable ? "" : " · read-only"}
          </p>
        </div>
        <span className="shrink-0 text-[11px] text-[var(--tx2)]">Open</span>
      </div>
    </button>
  )
}

export function FilesTab({ workspaceId }: { workspaceId: string }) {
  const snackbar = useSnackbarOptional()
  const show = snackbar?.show ?? (() => undefined)
  const [files, setFiles] = useState<CatalogFile[]>([])
  const [listError, setListError] = useState<string | null>(null)
  const [loadingList, setLoadingList] = useState(true)
  const [selected, setSelected] = useState<CatalogFile | null>(null)
  const [detail, setDetail] = useState<FileDetail | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const [restoreRow, setRestoreRow] = useState<FileHistoryRow | null>(null)

  const refreshList = useCallback(async () => {
    const res = await fetch(`/api/workspaces/${workspaceId}/files`)
    const json = (await res.json()) as { success?: boolean; data?: CatalogResponse }
    if (!res.ok || !json.success) {
      throw new Error("Could not load files")
    }
    setFiles(json.data?.files ?? [])
  }, [workspaceId])

  useEffect(() => {
    let cancelled = false
    setLoadingList(true)
    refreshList()
      .then(() => {
        if (!cancelled) setListError(null)
      })
      .catch((err: unknown) => {
        if (!cancelled) setListError(err instanceof Error ? err.message : "Could not load files")
      })
      .finally(() => {
        if (!cancelled) setLoadingList(false)
      })
    return () => {
      cancelled = true
    }
  }, [refreshList])

  const openFile = async (file: CatalogFile) => {
    setSelected(file)
    setDetail(null)
    setEditing(false)
    try {
      const res = await fetch(
        `/api/workspaces/${workspaceId}/files/content?path=${encodeURIComponent(file.logicalPath)}`,
      )
      const json = (await res.json()) as { success?: boolean; data?: FileDetail }
      if (!res.ok || !json.success || !json.data) throw new Error("Could not open file")
      setDetail(json.data)
      setDraft(json.data.content)
    } catch (err) {
      show({
        message: err instanceof Error ? err.message : "Could not open file",
        variant: "error",
      })
      setSelected(null)
    }
  }

  const saveEdit = async () => {
    if (!selected) return
    setBusy(true)
    try {
      await mutateWithFeedback(
        async () => {
          const res = await fetch(`/api/workspaces/${workspaceId}/files`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ path: selected.logicalPath, content: draft }),
          })
          if (!res.ok) throw new Error("Could not save file")
          setDetail((prev) => (prev ? { ...prev, content: draft } : prev))
          setEditing(false)
          await refreshList()
        },
        { message: "File saved", errorMessage: "Could not save file" },
        show,
      )
    } catch {
      /* snackbar already shown */
    } finally {
      setBusy(false)
    }
  }

  const confirmRestore = async () => {
    if (!restoreRow) return
    setBusy(true)
    try {
      await mutateWithFeedback(
        async () => {
          const res = await fetch(`/api/workspaces/${workspaceId}/files/restore`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fileVersionId: restoreRow.id }),
          })
          if (!res.ok) throw new Error("Could not restore version")
          if (selected) await openFile(selected)
          await refreshList()
        },
        { message: "Version restored", errorMessage: "Could not restore version" },
        show,
      )
      setRestoreRow(null)
    } catch {
      /* snackbar already shown */
    } finally {
      setBusy(false)
    }
  }

  const shared = files.filter((f) => f.owner === "human")
  const memory = files.filter((f) => f.owner === "agent")

  return (
    <div className="flex flex-col gap-[14px]">
      <section className="mb-0 rounded-lg border border-[var(--bd)] p-3.5" aria-label="Shared files">
        <h2 className="text-[14px] font-semibold text-[var(--tx)]">Shared</h2>
        <p className="mt-[3px] mb-[10px] text-[11px] text-[var(--tx3)]">
          Human-owned files under shared/ (USER.md, VOICE.md, deliverables). Edit writes a new version into the running Claw.
        </p>
        {loadingList ? (
          <p className="text-[11px] text-[var(--tx3)]">Loading files...</p>
        ) : listError ? (
          <p className="text-[11px] text-[var(--err)]">{listError}</p>
        ) : shared.length === 0 ? (
          <p className="text-[11px] text-[var(--tx3)]">No shared files yet.</p>
        ) : (
          <div className="flex flex-col gap-[8px]">
            {shared.map((file) => (
              <FileRow key={file.logicalPath} file={file} onOpen={(next) => void openFile(next)} />
            ))}
          </div>
        )}
      </section>

      <section className="mb-6 rounded-lg border border-[var(--bd)] p-3.5" aria-label="Agent memory">
        <h2 className="text-[14px] font-semibold text-[var(--tx)]">Agent memory</h2>
        <p className="mt-[3px] mb-[10px] text-[11px] text-[var(--tx3)]">
          Per-agent memory is read-only in this version.
        </p>
        {loadingList ? (
          <p className="text-[11px] text-[var(--tx3)]">Loading files...</p>
        ) : memory.length === 0 ? (
          <p className="text-[11px] text-[var(--tx3)]">No agent memory files yet.</p>
        ) : (
          <div className="flex flex-col gap-[8px]">
            {memory.map((file) => (
              <FileRow key={file.logicalPath} file={file} onOpen={(next) => void openFile(next)} />
            ))}
          </div>
        )}
      </section>

      <Modal
        open={selected !== null}
        onClose={() => {
          setSelected(null)
          setEditing(false)
          setDetail(null)
        }}
        title={selected?.logicalPath ?? "File"}
        description={selected?.editable ? "Human-owned" : "Read-only agent memory"}
        size="xl"
        footer={
          selected?.editable ? (
            <div className="flex items-center justify-end gap-[6px]">
              {editing ? (
                <>
                  <Button variant="outline" size="sm" onClick={() => setEditing(false)} disabled={busy}>
                    Cancel
                  </Button>
                  <Button variant="primary" size="sm" onClick={() => void saveEdit()} loading={busy}>
                    Save
                  </Button>
                </>
              ) : (
                <Button variant="outline" size="sm" onClick={() => setEditing(true)} disabled={!detail}>
                  Edit
                </Button>
              )}
            </div>
          ) : undefined
        }
      >
        {detail === null ? (
          <p className="text-[12px] text-[var(--tx3)]">Loading...</p>
        ) : (
          <div className="flex flex-col gap-[12px]">
            {editing ? (
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="min-h-[280px] text-[12px] font-mono"
              />
            ) : (
              <MarkdownBody content={detail.content} />
            )}
            {detail.history.length > 0 && (
              <div className="border-t border-[var(--bd)] pt-[8px]">
                <h3 className="mb-[6px] text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--tx3)]">
                  Version history
                </h3>
                <ul className="flex flex-col gap-[6px]">
                  {detail.history.map((row) => (
                    <li
                      key={row.id}
                      className="flex items-center justify-between gap-[8px] text-[11px] text-[var(--tx2)]"
                    >
                      <span>
                        v{row.version} · {row.trigger} · {formatWhen(row.createdAt)}
                      </span>
                      {selected?.editable && (
                        <Button variant="outline" size="xs" onClick={() => setRestoreRow(row)}>
                          Restore
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={restoreRow !== null}
        onClose={() => setRestoreRow(null)}
        onConfirm={() => void confirmRestore()}
        title="Restore this version?"
        description="Restoring writes a new version with the older content. The current file is not deleted."
        confirmLabel="Restore"
        variant="warning"
        loading={busy}
      />
    </div>
  )
}
