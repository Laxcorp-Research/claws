"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Clock } from "lucide-react"
import { cn } from "@/lib/utils"

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"))
const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"))
const POPOVER_WIDTH = 168

function parseHhMm(raw: string): { hour: string; minute: string } {
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return { hour: "08", minute: "00" }
  const hour = Math.min(23, Math.max(0, parseInt(m[1], 10)))
  const minute = Math.min(59, Math.max(0, parseInt(m[2], 10)))
  return {
    hour: String(hour).padStart(2, "0"),
    minute: String(minute).padStart(2, "0"),
  }
}

interface TimePickerProps {
  value: string
  onChange: (value: string) => void
  className?: string
  "aria-label": string
}

/**
 * Platform time picker - two-column portal listbox (hours | minutes).
 * Replaces the native browser time input so the builder matches Select styling.
 */
export function TimePicker({
  value,
  onChange,
  className,
  "aria-label": ariaLabel,
}: TimePickerProps) {
  const parsed = parseHhMm(value)
  const display = `${parsed.hour}:${parsed.minute}`
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{
    top: number
    left: number
    side: "top" | "bottom"
  } | null>(null)
  const triggerWrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const selectedHourRef = useRef<HTMLButtonElement>(null)
  const selectedMinuteRef = useRef<HTMLButtonElement>(null)

  const updatePosition = () => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const gap = 4
    const pad = 8
    const maxH = 220
    const spaceBelow = window.innerHeight - rect.bottom - pad
    const spaceAbove = rect.top - pad
    const preferBottom = spaceBelow >= Math.min(maxH, 120) || spaceBelow >= spaceAbove
    const side: "top" | "bottom" = preferBottom ? "bottom" : "top"
    const top = side === "bottom" ? rect.bottom + gap : rect.top - gap
    const maxLeft = window.innerWidth - POPOVER_WIDTH - pad
    setPos({ top, left: Math.max(pad, Math.min(rect.left, maxLeft)), side })
  }

  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    updatePosition()
    const onReposition = () => updatePosition()
    window.addEventListener("resize", onReposition)
    window.addEventListener("scroll", onReposition, true)
    return () => {
      window.removeEventListener("resize", onReposition)
      window.removeEventListener("scroll", onReposition, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    selectedHourRef.current?.scrollIntoView({ block: "center" })
    selectedMinuteRef.current?.scrollIntoView({ block: "center" })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDoc = (event: MouseEvent) => {
      const t = event.target as Node
      if (triggerWrapRef.current?.contains(t)) return
      if (popoverRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [open])

  const setHour = (hour: string) => onChange(`${hour}:${parsed.minute}`)
  const setMinute = (minute: string) => {
    onChange(`${parsed.hour}:${minute}`)
    setOpen(false)
  }

  const optionClass = (selected: boolean) =>
    cn(
      "block w-full px-[10px] py-[6px] text-center text-[11px] text-[var(--tx2)]",
      selected && "bg-[var(--bg3)] font-medium text-[var(--tx)]",
    )

  const popover =
    open && pos && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={popoverRef}
            role="dialog"
            aria-label={`${ariaLabel} picker`}
            data-side={pos.side}
            style={{
              position: "fixed",
              top: pos.side === "bottom" ? pos.top : undefined,
              bottom: pos.side === "top" ? window.innerHeight - pos.top : undefined,
              left: pos.left,
              width: POPOVER_WIDTH,
            }}
            className="z-50 flex rounded-[8px] border border-[var(--bd)] bg-[var(--bg)] shadow-modal"
          >
            <div
              role="listbox"
              aria-label="Hours"
              className="max-h-[220px] w-1/2 overflow-y-auto border-r border-[var(--bd)] py-[4px]"
            >
              {HOURS.map((hour) => (
                <button
                  key={hour}
                  ref={hour === parsed.hour ? selectedHourRef : undefined}
                  type="button"
                  role="option"
                  aria-label={`Hour ${hour}`}
                  aria-selected={hour === parsed.hour}
                  onClick={() => setHour(hour)}
                  className={optionClass(hour === parsed.hour)}
                >
                  {hour}
                </button>
              ))}
            </div>
            <div
              role="listbox"
              aria-label="Minutes"
              className="max-h-[220px] w-1/2 overflow-y-auto py-[4px]"
            >
              {MINUTES.map((minute) => (
                <button
                  key={minute}
                  ref={minute === parsed.minute ? selectedMinuteRef : undefined}
                  type="button"
                  role="option"
                  aria-label={`Minute ${minute}`}
                  aria-selected={minute === parsed.minute}
                  onClick={() => setMinute(minute)}
                  className={optionClass(minute === parsed.minute)}
                >
                  {minute}
                </button>
              ))}
            </div>
          </div>,
          document.body,
        )
      : null

  return (
    <div ref={triggerWrapRef} className={cn("relative min-w-0", className)}>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        data-value={display}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false)
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            setOpen((v) => !v)
          }
        }}
        className="flex h-[30px] w-full items-center justify-between gap-[6px] rounded-[8px] border border-[var(--bd)] bg-[var(--bg)] px-[8px] text-[11px] text-[var(--tx)] transition-colors hover:border-[var(--bd2)] focus:outline-none focus:border-[var(--tx)]"
      >
        <span>{display}</span>
        <Clock className="h-3 w-3 shrink-0 text-[var(--tx3)]" />
      </button>
      {popover}
    </div>
  )
}
