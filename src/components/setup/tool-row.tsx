"use client"

import { cn } from "@/lib/utils"
import { StatusDot } from "@/components/ui/status-dot"

export type ToolRowStatus = "connected" | "disconnected" | "error" | "connecting"

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
  className?: string
}

export function ToolRow({ name, description, connectionStatus, connectionType, swappable, errorMessage, onConnect, onSwap, onTest, onDisconnect, className }: ToolRowProps) {
  return (
    <div className={cn("flex items-center justify-between px-3.5 py-3 border-b border-[var(--bd)] last:border-b-0", className)}>
      <div className="flex items-center gap-2">
        <StatusDot status={connectionStatus === "connected" ? "connected" : connectionStatus === "connecting" ? "connecting" : connectionStatus === "error" ? "error" : "disconnected"} />
        <div>
          <div className="text-xs font-semibold">{name}</div>
          {description && <div className="text-[10px] text-[var(--tx2)]">{description}</div>}
          {connectionStatus === "error" && errorMessage && <div className="text-[10px] text-[var(--err)] mt-0.5">{errorMessage}</div>}
          {connectionStatus === "connecting" && <div className="text-[10px] text-[var(--ac)] mt-0.5">Connecting...</div>}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        {connectionStatus === "connected" && (
          <>
            <span className="text-[10px] text-[var(--ok)] font-medium">Connected</span>
            {onTest && <button onClick={onTest} className="text-[10px] px-2.5 py-[3px] rounded-md border border-[var(--bd)] text-[var(--tx2)] hover:border-[var(--bd2)] transition-colors">Test</button>}
            {onDisconnect && <button onClick={onDisconnect} className="text-[10px] px-2.5 py-[3px] text-[var(--tx3)] hover:text-[var(--err)] transition-colors">Disconnect</button>}
          </>
        )}
        {connectionStatus === "disconnected" && (
          <>
            {connectionType === "API_KEY" && onConnect && <button onClick={onConnect} className="text-[10px] px-2.5 py-[3px] rounded-md bg-[var(--tx)] text-white hover:opacity-90 transition-opacity">Enter API key</button>}
            {connectionType === "OAUTH_COMPOSIO" && onConnect && <button onClick={onConnect} className="text-[10px] px-2.5 py-[3px] rounded-md bg-[var(--tx)] text-white hover:opacity-90 transition-opacity">Connect via OAuth</button>}
            {swappable && onSwap && <button onClick={onSwap} className="text-[10px] px-2.5 py-[3px] rounded-md border border-[var(--bd)] text-[var(--tx2)] hover:border-[var(--bd2)] transition-colors">Swap</button>}
          </>
        )}
        {connectionStatus === "error" && onConnect && <button onClick={onConnect} className="text-[10px] px-2.5 py-[3px] rounded-md border border-[var(--err)] text-[var(--err)] hover:bg-[var(--errbg)] transition-colors">Reconnect</button>}
      </div>
    </div>
  )
}
