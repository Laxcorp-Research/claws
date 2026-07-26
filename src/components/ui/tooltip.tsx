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
 * Arrow contact: sideOffset={0} so Radix's `sideOffset + arrowHeight` places the
 * content exactly arrowHeight from the trigger; arrow span sits at content edge
 * (`[baseSide]:0`) and fills that gap — 0–1px content↔arrow abutment.
 * Do not force-visibility on the Arrow — that painted degenerate placement
 * (gap between arrow and content box). Native hide-when-unpointable stays.
 *
 * MUTATION: strip Portal / avoidCollisions / Arrow / documentElement boundary
 * → geometry / flip-side e2e fails.
 */

export const TooltipProvider = TooltipPrimitive.Provider

/** Arrow height used in Radix offset arithmetic — keep in sync with Arrow props. */
export const TOOLTIP_ARROW_HEIGHT = 5
export const TOOLTIP_ARROW_WIDTH = 10

interface TooltipProps {
  content: string
  children: React.ReactNode
  delay?: number
  maxWidth?: number
  side?: "top" | "bottom" | "left" | "right"
  /**
   * Prefer `center` when the trigger sizes to text (TruncateWithTooltip).
   * Use `start` only for intentionally wide full-bleed triggers.
   * Use `center` for icon/badge triggers.
   */
  align?: "start" | "center" | "end"
  /**
   * When true, never show the tooltip (still renders a width-stable trigger).
   * Pass a function to re-evaluate on every open attempt.
   */
  disabled?: boolean | (() => boolean)
  /** Extra classes on the trigger wrapper. */
  triggerClassName?: string
}

export function Tooltip({
  content,
  children,
  delay = 300,
  maxWidth = 220,
  side = "top",
  align = "center",
  disabled = false,
  triggerClassName,
}: TooltipProps) {
  const [open, setOpen] = React.useState(false)
  const contentRef = React.useRef<HTMLDivElement | null>(null)

  const isDisabled = React.useCallback(() => {
    return typeof disabled === "function" ? disabled() : Boolean(disabled)
  }, [disabled])

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      if (next && isDisabled()) return
      setOpen(next)
    },
    [isDisabled],
  )

  React.useEffect(() => {
    if (typeof disabled !== "function" && disabled) setOpen(false)
  }, [disabled])

  // Sync data-arrow-hidden from Radix's arrow span (visibility:hidden when
  // centerOffset≠0). Forced-edge probes assert this attribute — not silence.
  // Portal content mounts async — poll a few frames + observe style mutations.
  React.useEffect(() => {
    if (!open) return
    let cancelled = false
    let obs: MutationObserver | null = null
    let frames = 0

    const sync = () => {
      const contentEl = contentRef.current
      if (!contentEl || cancelled) return false
      const arrowWrap = contentEl.querySelector<HTMLElement>(":scope > span")
      const hidden =
        !!arrowWrap && getComputedStyle(arrowWrap).visibility === "hidden"
      contentEl.setAttribute("data-arrow-hidden", hidden ? "true" : "false")
      contentEl.setAttribute("data-arrow-visible", hidden ? "false" : "true")
      if (arrowWrap && !obs) {
        obs = new MutationObserver(sync)
        obs.observe(arrowWrap, { attributes: true, attributeFilter: ["style"] })
      }
      return true
    }

    const tick = () => {
      if (cancelled) return
      sync()
      frames += 1
      if (frames < 12) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)

    return () => {
      cancelled = true
      obs?.disconnect()
    }
  }, [open, content])

  // Viewport boundary — NOT clipping ancestors (sidebar overflow-y-auto).
  const collisionBoundary =
    typeof document !== "undefined" ? document.documentElement : undefined

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
            className={cn("inline-block w-max max-w-full min-w-0", triggerClassName)}
          >
            {children}
          </div>
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            ref={contentRef}
            side={side}
            align={align}
            // 0 + arrowHeight → content sits on the arrow; arrow abuts the box.
            sideOffset={0}
            collisionPadding={8}
            collisionBoundary={collisionBoundary}
            avoidCollisions
            role="tooltip"
            className="z-[9999] pointer-events-none bg-[var(--tx)] text-white text-[10px] leading-[1.4] px-[8px] py-[5px] rounded-[4px] shadow-modal w-max"
            style={{ maxWidth }}
          >
            {content}
            {/* Native Radix hide-on-unpointable retained — no force-visibility. */}
            <TooltipPrimitive.Arrow
              className="fill-[var(--tx)]"
              width={TOOLTIP_ARROW_WIDTH}
              height={TOOLTIP_ARROW_HEIGHT}
            />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  )
}
