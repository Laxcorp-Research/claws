"use client"

import { cloneElement, isValidElement, useId, useState, useRef, useCallback, useEffect, useLayoutEffect, type ReactNode, type ReactElement } from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"

interface TooltipProps {
  content: string
  children: ReactNode
  delay?: number
  maxWidth?: number
  side?: "top" | "bottom"
  /** When true, never show the tooltip (still renders a width-stable trigger wrapper). */
  disabled?: boolean
  /** Extra classes on the trigger wrapper — keep width-stable for TruncatedText. */
  triggerClassName?: string
}

export function Tooltip({
  content,
  children,
  delay = 300,
  maxWidth = 220,
  side = "top",
  disabled = false,
  triggerClassName,
}: TooltipProps) {
  const [show, setShow] = useState(false)
  const [pos, setPos] = useState({
    top: 0,
    left: 0,
    actualSide: side as "top" | "bottom",
    caretLeft: 0,
    shiftX: 0,
  })
  const tooltipId = useId()
  const triggerRef = useRef<HTMLDivElement>(null)
  const bubbleRef = useRef<HTMLDivElement>(null)
  const showTimeout = useRef<ReturnType<typeof setTimeout>>(undefined)
  const hideTimeout = useRef<ReturnType<typeof setTimeout>>(undefined)

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return
    const rect = triggerRef.current.getBoundingClientRect()
    const gap = 6
    const pad = 8

    let top = rect.top - gap
    let actualSide: "top" | "bottom" = side

    if (side === "top" && rect.top < 60) {
      top = rect.bottom + gap
      actualSide = "bottom"
    }

    const triggerCenter = rect.left + rect.width / 2
    // Center with translateX(-50%). Clamp using MEASURED bubble width when available.
    // MUTATION: left = triggerCenter - maxWidth/2 (no translateX -50%) → e2e bbox fails.
    const measured = bubbleRef.current?.offsetWidth ?? 0
    let shiftX = 0
    if (measured > 0) {
      const visualLeft = triggerCenter - measured / 2
      const visualRight = triggerCenter + measured / 2
      if (visualLeft < pad) shiftX = pad - visualLeft
      else if (visualRight > window.innerWidth - pad) shiftX = window.innerWidth - pad - visualRight
    }

    setPos({
      top,
      left: triggerCenter + shiftX,
      actualSide,
      caretLeft: measured > 0 ? measured / 2 - shiftX : 12,
      shiftX,
    })
  }, [side])

  const handleEnter = useCallback(() => {
    if (disabled) return
    clearTimeout(hideTimeout.current)
    showTimeout.current = setTimeout(() => {
      updatePosition()
      setShow(true)
    }, delay)
  }, [delay, disabled, updatePosition])

  const handleLeave = useCallback(() => {
    clearTimeout(showTimeout.current)
    hideTimeout.current = setTimeout(() => setShow(false), 100)
  }, [])

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === "Escape") {
      clearTimeout(showTimeout.current)
      setShow(false)
    }
  }, [])

  useEffect(() => {
    return () => {
      clearTimeout(showTimeout.current)
      clearTimeout(hideTimeout.current)
    }
  }, [])

  useEffect(() => {
    if (disabled) setShow(false)
  }, [disabled])

  // Re-measure after paint so clamping uses real bubble width.
  useLayoutEffect(() => {
    if (!show || disabled) return
    updatePosition()
  }, [show, disabled, content, updatePosition])

  const transform =
    pos.actualSide === "top"
      ? "translate(-50%, -100%)"
      : "translate(-50%, 0%)"

  const child = isValidElement(children)
    ? cloneElement(children as ReactElement<{ "aria-describedby"?: string }>, {
        "aria-describedby": show ? tooltipId : undefined,
      })
    : children

  return (
    <>
      <div
        ref={triggerRef}
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        onFocus={handleEnter}
        onBlur={handleLeave}
        onKeyDown={handleKeyDown}
        className={cn("block w-full min-w-0 max-w-full", triggerClassName)}
      >
        {child}
      </div>
      {show &&
        !disabled &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            id={tooltipId}
            role="tooltip"
            className="fixed z-[9999] pointer-events-none"
            style={{ top: pos.top, left: pos.left, transform }}
          >
            <div
              ref={bubbleRef}
              className="bg-[var(--tx)] text-white text-[10px] leading-[1.4] px-[8px] py-[5px] rounded-[4px] shadow-modal w-max"
              style={{ maxWidth }}
            >
              {content}
              <div
                className={`absolute border-[4px] border-transparent ${
                  pos.actualSide === "top"
                    ? "top-full border-t-[var(--tx)]"
                    : "bottom-full border-b-[var(--tx)]"
                }`}
                style={{ left: pos.caretLeft, transform: "translateX(-50%)" }}
              />
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
