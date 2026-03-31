"use client"

import { useState, useRef } from "react"
import { HelpCircle } from "lucide-react"

interface TooltipProps {
  text: string
  children?: React.ReactNode
}

export function Tooltip({ text, children }: TooltipProps) {
  const [show, setShow] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleEnter() {
    timeoutRef.current = setTimeout(() => setShow(true), 300)
  }

  function handleLeave() {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    setShow(false)
  }

  return (
    <div
      className="relative inline-flex items-center"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      {children || (
        <HelpCircle className="w-[12px] h-[12px] text-[var(--tx3)] cursor-help" />
      )}
      {show && (
        <div className="absolute z-50 bottom-[calc(100%+6px)] left-1/2 -translate-x-1/2 bg-[var(--tx)] text-white text-[10px] leading-[1.4] px-[8px] py-[5px] rounded-[4px] shadow-modal max-w-[220px] w-max pointer-events-none">
          {text}
          <div className="absolute top-full left-1/2 -translate-x-1/2 border-[4px] border-transparent border-t-[var(--tx)]" />
        </div>
      )}
    </div>
  )
}
