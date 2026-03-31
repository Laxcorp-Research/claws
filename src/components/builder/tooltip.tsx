"use client"

import { useState, useRef, useEffect } from "react"
import { createPortal } from "react-dom"
import { HelpCircle } from "lucide-react"

interface TooltipProps {
  text: string
  children?: React.ReactNode
}

export function Tooltip({ text, children }: TooltipProps) {
  const [show, setShow] = useState(false)
  const [coords, setCoords] = useState({ top: 0, left: 0 })
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const triggerRef = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  function handleEnter() {
    timeoutRef.current = setTimeout(() => {
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect()
        setCoords({ top: rect.top - 8, left: rect.left + rect.width / 2 })
      }
      setShow(true)
    }, 300)
  }

  function handleLeave() {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    setShow(false)
  }

  return (
    <>
      <div
        className="inline-flex items-center"
        onMouseEnter={handleEnter}
        onMouseLeave={handleLeave}
        ref={triggerRef}
      >
        {children || (
          <HelpCircle className="w-[12px] h-[12px] text-[var(--tx3)] cursor-help" />
        )}
      </div>
      {show && mounted && createPortal(
        <div
          className="fixed z-[9999] pointer-events-none"
          style={{ top: `${coords.top}px`, left: `${coords.left}px`, transform: "translate(-50%, -100%)" }}
        >
          <div className="bg-[var(--tx)] text-white text-[10px] leading-[1.4] px-[8px] py-[5px] rounded-[4px] shadow-modal max-w-[220px] w-max">
            {text}
            <div className="absolute top-full left-1/2 -translate-x-1/2 border-[4px] border-transparent border-t-[var(--tx)]" />
          </div>
        </div>,
        document.body
      )}
    </>
  )
}
