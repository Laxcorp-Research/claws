"use client"

import { useRef, useState, useCallback, useEffect } from "react"
import { Tooltip } from "./tooltip"
import { cn } from "@/lib/utils"

interface TruncatedTextProps {
  children: string
  className?: string
  as?: "span" | "div" | "p" | "td"
}

export function TruncatedText({
  children,
  className,
  as: Tag = "span",
}: TruncatedTextProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLElement>(null)
  const [isOverflowing, setIsOverflowing] = useState(false)

  const checkOverflow = useCallback(() => {
    const el = textRef.current
    if (!el) return
    setIsOverflowing(el.scrollWidth > el.clientWidth)
  }, [])

  useEffect(() => {
    let raf = 0
    // Post-layout remeasure: sync useEffect can run before the constrained
    // parent has a final width. rAF + ResizeObserver on the wrapper fix that.
    // MUTATION: drop the rAF schedule / only measure synchronously → overflow
    // detection flakes and truncation tests fail.
    const schedule = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        checkOverflow()
      })
    }

    schedule()

    const wrap = wrapRef.current
    const observer =
      typeof ResizeObserver !== "undefined" && wrap
        ? new ResizeObserver(schedule)
        : null
    if (wrap) observer?.observe(wrap)
    window.addEventListener("resize", schedule)
    return () => {
      cancelAnimationFrame(raf)
      observer?.disconnect()
      window.removeEventListener("resize", schedule)
    }
  }, [checkOverflow, children])

  const element = (
    <Tag
      ref={textRef as React.Ref<never>}
      className={cn(
        "block w-full min-w-0 max-w-full overflow-hidden text-ellipsis whitespace-nowrap",
        className,
      )}
    >
      {children}
    </Tag>
  )

  // Stable outer + Tooltip trigger (disabled when not truncated) so overflow
  // remounts do not collapse width via inline-flex content sizing.
  return (
    <div ref={wrapRef} className="block w-full min-w-0 max-w-full">
      <Tooltip content={children} maxWidth={400} disabled={!isOverflowing}>
        {element}
      </Tooltip>
    </div>
  )
}

export const TruncateWithTooltip = TruncatedText
