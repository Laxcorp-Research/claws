"use client"

import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"

interface ApiKeyRowProps {
  provider: string
  name: string
  status: "connected" | "disconnected" | "invalid"
  keyHint?: string
  lastUsedAt?: string
  lastError?: string
  /** Optional honesty badge (e.g. "beta — bring your own key"). */
  badge?: ReactNode
  onAdd: () => void
  onTest: () => void
  onRemove: () => void
  onUpdate: () => void
  isTestLoading?: boolean
}

export function ApiKeyRow({
  name,
  status,
  keyHint,
  lastUsedAt,
  lastError,
  badge,
  onAdd,
  onTest,
  onRemove,
  onUpdate,
  isTestLoading,
}: ApiKeyRowProps) {
  return (
    <div className="flex items-center justify-between p-[8px_10px] border-b border-[var(--bd)] last:border-b-0">
      <div className="flex items-center gap-[8px]">
        <div
          className={`w-[8px] h-[8px] rounded-full flex-shrink-0 ${
            status === "connected"
              ? "bg-[var(--ok)]"
              : status === "invalid"
                ? "bg-[var(--err)]"
                : "border-2 border-[var(--bd)] bg-transparent"
          }`}
          aria-hidden="true"
        />
        <div>
          <div className="flex items-center gap-1.5">
            <div className="text-[12px] font-semibold">{name}</div>
            {badge}
          </div>
          <div className="text-[10px] text-[var(--tx2)]">
            {status === "connected" && (
              <span>{keyHint ?? "***"} · {lastUsedAt ?? ""}</span>
            )}
            {status === "disconnected" && (
              <span>Not connected</span>
            )}
            {status === "invalid" && (
              <span className="text-[var(--err)]">Invalid - {lastError ?? "key failed validation"}</span>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-[4px]">
        {status === "connected" && (
          <>
            <span className="text-[10px] text-[var(--ok)] font-medium mr-0.5">Valid</span>
            <Button
              variant="ghost"
              className="text-[9px] px-[6px] py-[2px] h-auto"
              onClick={onTest}
              loading={isTestLoading}
              disabled={isTestLoading}
            >
              Test
            </Button>
            <button
              onClick={onRemove}
              className="text-[9px] px-[6px] py-[2px] rounded text-[var(--err)] hover:bg-[var(--bg2)] transition-colors"
            >
              Remove
            </button>
          </>
        )}

        {status === "disconnected" && (
          <Button
            variant="primary"
            size="sm"
            className="text-[10px] px-[10px] py-[3px]"
            onClick={onAdd}
          >
            Add API key
          </Button>
        )}

        {status === "invalid" && (
          <>
            <span className="text-[10px] text-[var(--err)] font-medium mr-0.5">Invalid</span>
            <Button
              variant="primary"
              size="sm"
              className="text-[10px] px-[10px] py-[3px]"
              onClick={onUpdate}
            >
              Update
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
