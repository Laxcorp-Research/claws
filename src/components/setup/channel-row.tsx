"use client"

import { Button } from "@/components/ui/button"
import { StatusDot } from "@/components/ui/status-dot"
import { AlertTriangle } from "lucide-react"
import type { ReactNode } from "react"

interface ChannelRowProps {
  name: string
  description: string
  icon: ReactNode
  status: "connected" | "disconnected" | "connecting" | "error"
  errorMessage?: string
  alwaysConnected?: boolean
  onConnect: () => void
  onDisconnect: () => void
  action?: ReactNode
}

export function ChannelRow({ name, description, icon, status, errorMessage, alwaysConnected = false, onConnect, onDisconnect, action }: ChannelRowProps) {
  return (
    <div className="px-3 py-2.5 border-b border-[var(--bd)] last:border-b-0">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="w-5 flex items-center justify-center text-[var(--tx2)]">{icon}</span>
          <div>
            <p className="text-xs font-semibold">{name}</p>
            <p className="text-[10px] text-[var(--tx2)]">{description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {status === "error" ? (
            <AlertTriangle className="w-3.5 h-3.5 text-[var(--err)]" aria-hidden="true" />
          ) : (
            <StatusDot status={status === "connected" ? "connected" : status === "connecting" ? "connecting" : "disconnected"} />
          )}
          {action ?? (alwaysConnected ? (
            <span className="text-[10px] text-[var(--ok)] font-medium">Always active</span>
          ) : status === "connected" ? (
            <Button variant="outline" size="sm" onClick={onDisconnect}>Disconnect</Button>
          ) : status === "connecting" ? (
            <Button variant="outline" size="sm" disabled>Connecting…</Button>
          ) : status === "error" ? (
            <Button variant="outline" size="sm" onClick={onConnect}>Retry</Button>
          ) : (
            <Button variant="primary" size="sm" onClick={onConnect}>Connect</Button>
          ))}
        </div>
      </div>
      {status === "error" && errorMessage && (
        <p className="text-[11px] text-[var(--err)] mt-1 ml-[30px]">{errorMessage}</p>
      )}
    </div>
  )
}
