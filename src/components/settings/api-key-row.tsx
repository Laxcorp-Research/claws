"use client"

import { Button } from "@/components/ui/button"
import { AlertTriangle, Check, Loader2 } from "lucide-react"

const PROVIDER_URLS: Record<string, string> = {
  ANTHROPIC: "https://console.anthropic.com",
  OPENAI: "https://platform.openai.com/api-keys",
  GOOGLE: "https://aistudio.google.com/apikey",
}

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
  onReplace?: () => void
}

export function ApiKeyRow({ provider, displayName, isConnected, keyHint, addedDate, isValid, isTesting, onTest, onRemove, onAdd, onReplace }: ApiKeyRowProps) {
  const isInvalid = isConnected && !isValid && !isTesting
  const dashboardUrl = PROVIDER_URLS[provider]

  return (
    <div className="px-3 py-2.5 border-b border-[var(--bd)] last:border-b-0">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          {isInvalid ? (
            <AlertTriangle className="w-3.5 h-3.5 text-[var(--err)] shrink-0" aria-hidden="true" />
          ) : (
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${!isConnected ? "bg-[var(--tx3)]" : isValid ? "bg-[var(--ok)]" : "bg-[var(--tx3)]"}`} aria-hidden="true" />
          )}
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
              <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
              Testing...
            </span>
          )}
          {isConnected && !isTesting && isValid && (
            <>
              <span className="text-[10px] text-[var(--ok)] font-medium mr-1 inline-flex items-center gap-0.5">
                <Check className="w-3 h-3" /> Valid
              </span>
              {onTest && <Button variant="ghost" size="xs" onClick={onTest}>Test</Button>}
              {onRemove && <button onClick={onRemove} className="text-[9px] px-1.5 py-px rounded text-[var(--err)] hover:bg-[var(--bg2)] transition-colors">Remove</button>}
            </>
          )}
          {isInvalid && (
            <>
              <span className="text-[10px] text-[var(--err)] font-medium mr-1">Invalid</span>
              {onTest && <Button variant="ghost" size="xs" onClick={onTest}>Retest</Button>}
              {onReplace && <Button variant="outline" size="xs" onClick={onReplace}>Replace key</Button>}
              {onRemove && <button onClick={onRemove} className="text-[9px] px-1.5 py-px rounded text-[var(--err)] hover:bg-[var(--bg2)] transition-colors">Remove</button>}
            </>
          )}
          {!isConnected && !isTesting && onAdd && (
            <Button variant="primary" size="sm" onClick={onAdd}>Add API key</Button>
          )}
        </div>
      </div>
      {isInvalid && dashboardUrl && (
        <p className="text-[11px] text-[var(--err)] mt-1.5 ml-[22px]">
          This key failed validation. It may have expired or been revoked.{" "}
          Check your{" "}
          <a href={dashboardUrl} target="_blank" rel="noopener noreferrer" className="font-semibold underline">
            {displayName.split(" (")[0]} dashboard
          </a>{" "}
          and replace it.
        </p>
      )}
    </div>
  )
}
