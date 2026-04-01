"use client"

import { cn } from "@/lib/utils"
import { StatusDot } from "@/components/ui/status-dot"
import { AlertTriangle, Loader2 } from "lucide-react"

export type ToolRowStatus = "connected" | "disconnected" | "error" | "connecting" | "testing"

interface ToolRowProps {
  name: string
  description?: string
  connectionStatus: ToolRowStatus
  connectionType: "API_KEY" | "OAUTH_COMPOSIO"
  swappable?: boolean
  errorMessage?: string
  onConnect?: () => void
  onSwap?: () => void
  onTest?: () => void
  onDisconnect?: () => void
  onReconnect?: () => void
  className?: string
}

export function ToolRow({ name, description, connectionStatus, connectionType, swappable, errorMessage, onConnect, onSwap, onTest, onDisconnect, onReconnect, className }: ToolRowProps) {
  const isError = connectionStatus === "error"
  const isTesting = connectionStatus === "testing"

  return (
    <div className={cn("px-3.5 py-3 border-b border-[var(--bd)] last:border-b-0", className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {isError ? (
            <AlertTriangle className="w-3.5 h-3.5 text-[var(--err)] shrink-0" aria-hidden="true" />
          ) : (
            <StatusDot status={connectionStatus === "connected" || isTesting ? "connected" : connectionStatus === "connecting" ? "connecting" : "disconnected"} />
          )}
          <div>
            <div className="text-xs font-semibold">{name}</div>
            {description && <div className="text-[10px] text-[var(--tx2)]">{description}</div>}
            {connectionStatus === "connecting" && <div className="text-[10px] text-[var(--ac)] mt-0.5 inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" /> Connecting...</div>}
            {isError && !errorMessage && <div className="text-[10px] text-[var(--err)] mt-0.5">Connection failed</div>}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {(connectionStatus === "connected" || isTesting) && (
            <>
              <span className="text-[10px] text-[var(--ok)] font-medium">Connected</span>
              {onTest && (
                <button onClick={onTest} disabled={isTesting} className={cn("text-[10px] px-2.5 py-[3px] rounded-md border border-[var(--bd)] text-[var(--tx2)] transition-colors", isTesting ? "opacity-50" : "hover:border-[var(--bd2)]")}>
                  {isTesting ? <span className="inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" /> Testing...</span> : "Test"}
                </button>
              )}
              {onDisconnect && <button onClick={onDisconnect} className="text-[10px] px-2.5 py-[3px] text-[var(--tx3)] hover:text-[var(--err)] transition-colors">Disconnect</button>}
            </>
          )}
          {connectionStatus === "disconnected" && (
            <>
              {connectionType === "API_KEY" && onConnect && <button onClick={onConnect} className="text-[10px] px-2.5 py-[3px] rounded-md bg-[var(--tx)] text-white hover:opacity-90 transition-opacity">Enter API key</button>}
              {connectionType === "OAUTH_COMPOSIO" && (
                <span className="text-[10px] text-[var(--tx3)] px-[8px] py-[3px] border border-[var(--bd)] rounded-[4px]">
                  OAuth — Coming soon
                </span>
              )}
              {swappable && onSwap && <button onClick={onSwap} className="text-[10px] px-2.5 py-[3px] rounded-md border border-[var(--bd)] text-[var(--tx2)] hover:border-[var(--bd2)] transition-colors">Swap</button>}
            </>
          )}
          {connectionStatus === "connecting" && (
            <button disabled className="text-[10px] px-2.5 py-[3px] rounded-md border border-[var(--bd)] text-[var(--tx3)] opacity-50">Connecting…</button>
          )}
          {isError && (onReconnect || onConnect) && (
            <button onClick={onReconnect || onConnect} className="text-[10px] px-2.5 py-[3px] rounded-md border border-[var(--err)] text-[var(--err)] hover:bg-[var(--errbg)] transition-colors">Retry</button>
          )}
        </div>
      </div>
      {isError && errorMessage && (
        <p className="text-[11px] text-[var(--err)] mt-1.5 ml-[22px]">
          {errorMessage}
          {onReconnect && <button onClick={onReconnect} className="font-semibold underline ml-1">Reconnect</button>}
        </p>
      )}
    </div>
  )
}
