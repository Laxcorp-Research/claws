"use client"

import { Button } from "@/components/ui/button"

interface ApiKeyRowProps {
  provider: string
  displayName: string
  isConnected: boolean
  keyHint?: string
  addedDate?: string
  isValid?: boolean
  isTesting?: boolean
  onTest?: () => void
  onRemove?: () => void
  onAdd?: () => void
}

export function ApiKeyRow({ displayName, isConnected, keyHint, addedDate, isValid, isTesting, onTest, onRemove, onAdd }: ApiKeyRowProps) {
  const dotColor = !isConnected ? "bg-[var(--tx3)]" : isValid ? "bg-[var(--ok)]" : "bg-[var(--err)]"

  return (
    <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--bd)] last:border-b-0">
      <div className="flex items-center gap-2.5">
        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColor}`} />
        <div>
          <div className="text-[12px] font-medium">{displayName}</div>
          <div className="text-[11px] text-[var(--tx2)]">
            {isConnected ? `${keyHint ?? "***"} · ${addedDate ?? ""}` : "Not connected"}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {isTesting && (
          <span className="flex items-center gap-1 text-[10px] text-[var(--tx2)]">
            <span className="w-3 h-3 border-2 border-[var(--tx2)] border-t-transparent rounded-full animate-spin" />
            Testing...
          </span>
        )}
        {isConnected && !isTesting && (
          <>
            {isValid ? (
              <span className="text-[10px] text-[var(--ok)] font-medium mr-1">Valid</span>
            ) : (
              <span className="text-[10px] text-[var(--err)] font-medium mr-1">Invalid</span>
            )}
            {onTest && (
              <Button variant="ghost" size="xs" onClick={onTest}>Test</Button>
            )}
            {onRemove && (
              <button onClick={onRemove} className="text-[9px] px-1.5 py-px rounded text-[var(--err)] hover:bg-[var(--bg2)] transition-colors">Remove</button>
            )}
          </>
        )}
        {!isConnected && !isTesting && onAdd && (
          <Button variant="primary" size="sm" onClick={onAdd}>Add API key</Button>
        )}
      </div>
    </div>
  )
}
