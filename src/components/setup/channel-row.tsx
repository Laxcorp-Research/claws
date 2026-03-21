"use client"

import { Button } from "@/components/ui/button"
import { StatusDot } from "@/components/ui/status-dot"
import type { ReactNode } from "react"

interface ChannelRowProps {
  name: string
  description: string
  icon: ReactNode
  status: "connected" | "disconnected" | "connecting"
  alwaysConnected?: boolean
  onConnect: () => void
  onDisconnect: () => void
}

export function ChannelRow({ name, description, icon, status, alwaysConnected = false, onConnect, onDisconnect }: ChannelRowProps) {
  return (
    <div className="flex items-center justify-between px-3 py-2.5 border-b border-[var(--bd)] last:border-b-0">
      <div className="flex items-center gap-2.5">
        <span className="w-5 flex items-center justify-center text-[var(--tx2)]">{icon}</span>
        <div>
          <p className="text-xs font-semibold">{name}</p>
          <p className="text-[10px] text-[var(--tx2)]">{description}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <StatusDot status={status === "connected" ? "connected" : status === "connecting" ? "connecting" : "disconnected"} />
        {alwaysConnected ? (
          <span className="text-[10px] text-[var(--ok)] font-medium">Always active</span>
        ) : status === "connected" ? (
          <Button variant="outline" size="sm" onClick={onDisconnect}>Disconnect</Button>
        ) : status === "connecting" ? (
          <Button variant="outline" size="sm" disabled>Connecting…</Button>
        ) : (
          <Button variant="primary" size="sm" onClick={onConnect}>Connect</Button>
        )}
      </div>
    </div>
  )
}
