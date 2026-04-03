"use client"

import { useState, useRef, useEffect } from "react"
import { ChevronDown } from "lucide-react"
import { TruncateWithTooltip } from "@/components/ui/truncate-with-tooltip"

interface CustomSelectOption {
  value: string
  label: string
}

interface CustomSelectProps {
  value: string
  onChange: (value: string) => void
  options: CustomSelectOption[]
  placeholder?: string
  className?: string
}

export function CustomSelect({ value, onChange, options, placeholder, className }: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [openUpward, setOpenUpward] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  useEffect(() => {
    if (isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      const spaceBelow = window.innerHeight - rect.bottom
      setOpenUpward(spaceBelow < 220)
    }
  }, [isOpen])

  const selectedLabel = options.find(o => o.value === value)?.label || placeholder || "Select..."

  return (
    <div className={`relative ${className || ""}`} ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between gap-[4px] border border-[var(--bd)] rounded-[6px] px-[8px] py-[5px] text-[11px] bg-[var(--bg)] text-[var(--tx)] cursor-pointer hover:border-[var(--tx3)] transition-colors"
        onKeyDown={(e) => { if (e.key === "Escape") setIsOpen(false) }}
      >
        <TruncateWithTooltip>{selectedLabel}</TruncateWithTooltip>
        <ChevronDown className={`w-[12px] h-[12px] text-[var(--tx3)] flex-shrink-0 transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {isOpen && (
        <div
          className={`absolute z-50 left-0 right-0 bg-[var(--bg)] border border-[var(--bd)] rounded-[8px] shadow-modal py-[4px] max-h-[200px] overflow-y-auto ${
            openUpward ? "bottom-[calc(100%+4px)]" : "top-[calc(100%+4px)]"
          }`}
          role="listbox"
        >
          {options.map(option => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              onClick={() => {
                onChange(option.value)
                setIsOpen(false)
              }}
              className={`w-full text-left px-[10px] py-[5px] text-[11px] cursor-pointer transition-colors ${
                option.value === value
                  ? "font-medium text-[var(--tx)] bg-[var(--bg2)]"
                  : "text-[var(--tx2)] hover:bg-[var(--bg2)]"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
