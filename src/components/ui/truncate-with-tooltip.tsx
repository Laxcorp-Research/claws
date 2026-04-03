"use client"

import { useRef, useState, useCallback, useEffect } from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"

interface TruncateWithTooltipProps {
  children: string
  className?: string
  as?: "span" | "div" | "p" | "td"
}

export function TruncateWithTooltip({
  children,
  className,
  as: Tag = "span",
}: TruncateWithTooltipProps) {
  const ref = useRef<HTMLElement>(null)
  const [isOverflowing, setIsOverflowing] = useState(false)
  const [showTooltip, setShowTooltip] = useState(false)
  const [tooltipPos, setTooltipPos] = useState({ top: 0, left: 0 })
  const [mounted, setMounted] = useState(false)
  const hideTimeout = useRef<ReturnType<typeof setTimeout>>(undefined)
  const showTimeout = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    setMounted(true)
  }, [])

  const checkOverflow = useCallback(() => {
    if (ref.current) {
      setIsOverflowing(ref.current.scrollWidth > ref.current.clientWidth)
    }
  }, [])

  useEffect(() => {
    checkOverflow()
    window.addEventListener("resize", checkOverflow)
    return () => window.removeEventListener("resize", checkOverflow)
  }, [checkOverflow, children])

  const handleMouseEnter = useCallback(() => {
    if (!isOverflowing) return
    clearTimeout(hideTimeout.current)
    showTimeout.current = setTimeout(() => {
      if (ref.current) {
        const rect = ref.current.getBoundingClientRect()
        setTooltipPos({
          top: rect.top - 8,
          left: rect.left + rect.width / 2,
        })
        setShowTooltip(true)
      }
    }, 300)
  }, [isOverflowing])

  const handleMouseLeave = useCallback(() => {
    clearTimeout(showTimeout.current)
    hideTimeout.current = setTimeout(() => setShowTooltip(false), 100)
  }, [])

  return (
    <>
      <Tag
        ref={ref as React.Ref<never>}
        className={cn("truncate", className)}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {children}
      </Tag>
      {showTooltip && mounted &&
        createPortal(
          <div
            className="fixed z-[9999] pointer-events-none"
            style={{
              top: `${tooltipPos.top}px`,
              left: `${tooltipPos.left}px`,
              transform: "translate(-50%, -100%)",
            }}
          >
            <div className="bg-[var(--tx)] text-white text-[10px] leading-[1.4] px-[8px] py-[5px] rounded-[4px] shadow-modal max-w-[300px] w-max">
              {children}
              <div className="absolute top-full left-1/2 -translate-x-1/2 border-[4px] border-transparent border-t-[var(--tx)]" />
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
