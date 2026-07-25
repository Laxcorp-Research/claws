"use client"

import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"
import { cn } from "@/lib/utils"

/**
 * DS Tooltip — Radix Tooltip primitive.
 * Portal to body + collision detection (flip/shift) are mandatory.
 * collisionBoundary = documentElement so overflow scroll ancestors (e.g. builder
 * agent sidebar) do NOT become the flip boundary — viewport room wins.
 * Do NOT import @radix-ui/react-tooltip outside this file (grep-guard).
 *
 * MUTATION: strip Portal / avoidCollisions / Arrow / documentElement boundary
 * → geometry / flip-side e2e fails.
 */

export const TooltipProvider = TooltipPrimitive.Provider

interface TooltipProps {
  content: string
  children: React.ReactNode
  delay?: number
  maxWidth?: number
  side?: "top" | "bottom" | "left" | "right"
  /**
   * Prefer `start` for TruncatedText / full-width triggers so the bubble
   * anchors to the text edge, not the center of a wide flex cell.
   * Use `center` for icon/badge triggers.
   */
  align?: "start" | "center" | "end"
  /**
   * When true, never show the tooltip (still renders a width-stable trigger).
   * Pass a function to re-evaluate on every open attempt (TruncatedText hover remasure).
   */
  disabled?: boolean | (() => boolean)
  /** Extra classes on the trigger wrapper — keep width-stable for TruncatedText. */
  triggerClassName?: string
}

export function Tooltip({
  content,
  children,
  delay = 300,
  maxWidth = 220,
  side = "top",
  align = "start",
  disabled = false,
  triggerClassName,
}: TooltipProps) {
  const [open, setOpen] = React.useState(false)

  const isDisabled = React.useCallback(() => {
    return typeof disabled === "function" ? disabled() : Boolean(disabled)
  }, [disabled])

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      // Evaluate disabled at open time so TruncatedText can remasure live
      // (stale boolean disabled left SS2 Trend & Topic tip dead).
      if (next && isDisabled()) return
      setOpen(next)
    },
    [isDisabled],
  )

  React.useEffect(() => {
    if (typeof disabled !== "function" && disabled) setOpen(false)
  }, [disabled])

  // Viewport boundary — NOT clipping ancestors (sidebar overflow-y-auto).
  // Item-0: unset default [] let agent-sidebar clip force side=bottom mid-list.
  const collisionBoundary =
    typeof document !== "undefined" ? document.documentElement : undefined

  // Local Provider so unit tests / isolated mounts work without app Providers.
  // App-level TooltipProvider still supplies skipDelay across sibling tips.
  return (
    <TooltipPrimitive.Provider delayDuration={delay} disableHoverableContent>
      <TooltipPrimitive.Root
        open={open}
        onOpenChange={handleOpenChange}
        delayDuration={delay}
        disableHoverableContent
      >
        <TooltipPrimitive.Trigger asChild>
          <div
            data-tooltip-trigger
            className={cn("block w-full min-w-0 max-w-full", triggerClassName)}
          >
            {children}
          </div>
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            align={align}
            sideOffset={6}
            collisionPadding={8}
            collisionBoundary={collisionBoundary}
            avoidCollisions
            role="tooltip"
            className="z-[9999] pointer-events-none bg-[var(--tx)] text-white text-[10px] leading-[1.4] px-[8px] py-[5px] rounded-[4px] shadow-modal w-max"
            style={{ maxWidth }}
          >
            {content}
            {/* Arrow 10×5 (Radix default proportions) — part of DS contract. */}
            <TooltipPrimitive.Arrow className="fill-[var(--tx)]" width={10} height={5} />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  )
}
