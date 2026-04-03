"use client"

import { useRef, useState, useCallback, useEffect } from "react"
import { Tooltip } from "./tooltip"
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
