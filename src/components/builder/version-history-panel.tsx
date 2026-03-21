"use client"

import { useEffect } from "react"
import { useBuilderStore } from "@/stores/builder-store"
import { Button } from "@/components/ui/button"

interface VersionHistoryPanelProps {
  open: boolean
  onClose: () => void
}

export function VersionHistoryPanel({ open, onClose }: VersionHistoryPanelProps) {
  const { snapshots, isLoadingSnapshots, loadSnapshots, restoreSnapshot } = useBuilderStore()

  useEffect(() => {
    if (open) loadSnapshots()
  }, [open, loadSnapshots])

  if (!open) return null

  return (
    <div className="absolute top-0 right-0 bottom-0 w-[260px] bg-[var(--bg)] border-l border-[var(--bd)] z-20 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-2.5 py-2 border-b border-[var(--bd)]">
        <h4 className="text-[10px] font-semibold text-[var(--tx2)] uppercase tracking-wider">Version History</h4>
        <button onClick={onClose} className="text-[var(--tx3)] hover:text-[var(--tx)] text-sm" aria-label="Close history">
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2.5">
        {isLoadingSnapshots ? (
          <p className="text-[11px] text-[var(--tx3)]">Loading...</p>
        ) : snapshots.length === 0 ? (
          <p className="text-[11px] text-[var(--tx3)]">No snapshots yet. Changes auto-save every 2 seconds.</p>
        ) : (
          <div className="space-y-1.5">
            {snapshots.map((snap) => (
              <div key={snap.id} className="border border-[var(--bd)] rounded-[6px] p-2 hover:border-[var(--bd2)] transition-colors">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-medium text-[var(--tx)]">v{snap.version}</span>
                  <span className={`text-[9px] px-1.5 py-[1px] rounded-[4px] ${
                    snap.trigger === "TEMPLATE_LOAD" ? "bg-[var(--acbg)] text-[var(--ac)]"
                    : snap.trigger === "MANUAL_SAVE" || snap.trigger === "USER_LABELED" ? "bg-[var(--okbg)] text-[var(--ok)]"
                    : "bg-[var(--bg2)] text-[var(--tx3)]"
                  }`}>
                    {snap.trigger === "TEMPLATE_LOAD" ? "Template" : snap.trigger === "AUTO_SAVE" ? "Auto" : snap.trigger === "MANUAL_SAVE" ? "Manual" : snap.trigger === "PRE_DEPLOY" ? "Pre-deploy" : "Labeled"}
                  </span>
                </div>
                {snap.label && <p className="text-[10px] text-[var(--tx2)] mb-1 truncate">{snap.label}</p>}
                <div className="flex items-center justify-between">
                  <span className="text-[9px] text-[var(--tx3)]">
                    {new Date(snap.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => {
                      if (confirm("Revert workspace to this version? Current unsaved changes will be lost.")) {
                        restoreSnapshot(snap.id)
                        onClose()
                      }
                    }}
                  >
                    Restore
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
