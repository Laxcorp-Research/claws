"use client"

import { cloneElement, isValidElement, useId, useState, useRef, useCallback, useEffect, type ReactNode, type ReactElement } from "react"
import { createPortal } from "react-dom"

interface TooltipProps {
  content: string
  children: ReactNode
  delay?: number
  maxWidth?: number
  side?: "top" | "bottom"
}

export function Tooltip({
  content,
  children,
  delay = 300,
  maxWidth = 220,
  side = "top",
}: TooltipProps) {
  const [show, setShow] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0, actualSide: side, caretLeft: 0 })
  const tooltipId = useId()
  const triggerRef = useRef<HTMLDivElement>(null)
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
    let left = triggerCenter - maxWidth / 2
    left = Math.max(pad, left)
    left = Math.min(window.innerWidth - maxWidth - pad, left)
    const caretLeft = Math.max(12, Math.min(triggerCenter - left, maxWidth - 12))

    setPos({ top, left, actualSide, caretLeft })
  }, [side, maxWidth])

  const handleEnter = useCallback(() => {
    clearTimeout(hideTimeout.current)
    showTimeout.current = setTimeout(() => {
      updatePosition()
      setShow(true)
    }, delay)
  }, [delay, updatePosition])

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

  const transform =
    pos.actualSide === "top" ? "translateY(-100%)" : "translateY(0%)"

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
        className="inline-flex items-center max-w-full"
      >
        {child}
      </div>
      {show &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            id={tooltipId}
            role="tooltip"
            className="fixed z-[9999] pointer-events-none"
            style={{ top: pos.top, left: pos.left, transform }}
          >
            <div
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
