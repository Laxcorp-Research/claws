"use client"

import { Children, isValidElement, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { TruncatedText } from "@/components/ui/truncate-with-tooltip"

interface SelectOption {
  value: string
  label: string
}

interface SelectProps {
  value?: string
  onChange?: (event: { target: { value: string } }) => void
  onValueChange?: (value: string) => void
  options?: SelectOption[]
  children?: ReactNode
  placeholder?: string
  variant?: "default" | "compact"
  className?: string
  "aria-label"?: string
}

function optionsFromChildren(children: ReactNode): SelectOption[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<{ value?: string; children?: ReactNode }>(child)) return []
    const value = child.props.value ?? ""
    const label = typeof child.props.children === "string" ? child.props.children : String(child.props.children ?? value)
    return [{ value, label }]
  })
}

export function Select({ value = "", onChange, onValueChange, options, children, placeholder = "Select...", className, "aria-label": ariaLabel }: SelectProps) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const typeaheadRef = useRef("")
  const typeaheadTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const items = useMemo(() => options ?? optionsFromChildren(children), [options, children])
  const selectedIndex = Math.max(0, items.findIndex((item) => item.value === value))
  const selected = items.find((item) => item.value === value)

  useEffect(() => {
    const onDoc = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [])

  const commit = (next: string) => {
    onValueChange?.(next)
    onChange?.({ target: { value: next } })
    setOpen(false)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape") {
      setOpen(false)
      return
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      setOpen(true)
      setActiveIndex((idx) => {
        const delta = event.key === "ArrowDown" ? 1 : -1
        return (idx + delta + items.length) % Math.max(items.length, 1)
      })
      return
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      if (open && items[activeIndex]) commit(items[activeIndex].value)
      else {
        setActiveIndex(selectedIndex)
        setOpen(true)
      }
      return
    }
    if (event.key.length === 1) {
      typeaheadRef.current += event.key.toLowerCase()
      clearTimeout(typeaheadTimer.current)
      typeaheadTimer.current = setTimeout(() => { typeaheadRef.current = "" }, 600)
      const idx = items.findIndex((item) => item.label.toLowerCase().startsWith(typeaheadRef.current))
      if (idx >= 0) {
        setOpen(true)
        setActiveIndex(idx)
      }
    }
  }

  return (
    <div ref={ref} className={cn("relative", className)}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => {
          setActiveIndex(selectedIndex)
          setOpen((v) => !v)
        }}
        onKeyDown={onKeyDown}
        className="flex h-[30px] w-full items-center justify-between gap-[6px] rounded-[8px] border border-[var(--bd)] bg-[var(--bg)] px-[8px] text-[11px] text-[var(--tx)] transition-colors hover:border-[var(--bd2)] focus:outline-none focus:border-[var(--tx)]"
      >
        <TruncatedText>{selected?.label ?? placeholder}</TruncatedText>
        <ChevronDown className={cn("h-3 w-3 shrink-0 text-[var(--tx3)] transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div role="listbox" className="absolute left-0 right-0 top-[calc(100%+4px)] z-50 max-h-[220px] overflow-y-auto rounded-[8px] border border-[var(--bd)] bg-[var(--bg)] py-[4px] shadow-modal">
          {items.map((item, index) => (
            <button
              key={item.value}
              type="button"
              role="option"
              aria-selected={item.value === value}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => commit(item.value)}
              className={cn(
                "block w-full px-[10px] py-[6px] text-left text-[11px] text-[var(--tx2)]",
                index === activeIndex && "bg-[var(--bg2)] text-[var(--tx)]",
                item.value === value && "bg-[var(--bg3)] font-medium text-[var(--tx)]",
              )}
            >
              <TruncatedText>{item.label}</TruncatedText>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
