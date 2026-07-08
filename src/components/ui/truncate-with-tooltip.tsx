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
  const ref = useRef<HTMLElement>(null)
  const [isOverflowing, setIsOverflowing] = useState(false)

  const checkOverflow = useCallback(() => {
    if (ref.current) {
      setIsOverflowing(ref.current.scrollWidth > ref.current.clientWidth)
    }
  }, [])

  useEffect(() => {
    checkOverflow()
    const observer = typeof ResizeObserver !== "undefined" && ref.current
      ? new ResizeObserver(checkOverflow)
      : null
    if (ref.current) observer?.observe(ref.current)
    window.addEventListener("resize", checkOverflow)
    return () => {
      observer?.disconnect()
      window.removeEventListener("resize", checkOverflow)
    }
  }, [checkOverflow, children])

  const element = (
    <Tag ref={ref as React.Ref<never>} className={cn("truncate", className)}>
      {children}
    </Tag>
  )

  if (isOverflowing) {
    return (
      <Tooltip content={children} maxWidth={300}>
        {element}
      </Tooltip>
    )
  }

  return element
}

export const TruncateWithTooltip = TruncatedText
