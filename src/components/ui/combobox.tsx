"use client"

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react"
import { createPortal } from "react-dom"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import { TruncatedText } from "@/components/ui/truncate-with-tooltip"
import { Input } from "@/components/ui/input"

export const MODEL_COMBOBOX_ROW_HEIGHT = 28
export const MODEL_COMBOBOX_VIEWPORT = 220
const OVERSCAN = 6

export type ComboboxItem = {
  value: string
  label: string
  tag?: string
  disabled?: boolean
  hint?: string
  keywords?: string
}

export type ComboboxGroup = {
  heading: string
  items: ComboboxItem[]
}

type FlatRow =
  | { kind: "header"; id: string; heading: string }
  | { kind: "item"; id: string; item: ComboboxItem }

function flatten(groups: ComboboxGroup[], query: string): FlatRow[] {
  const q = query.trim().toLowerCase()
  const rows: FlatRow[] = []
  for (const group of groups) {
    const items = q
      ? group.items.filter((item) => {
          const hay = `${item.label} ${item.tag ?? ""} ${item.keywords ?? ""}`.toLowerCase()
          return hay.includes(q)
        })
      : group.items
    if (items.length === 0) continue
    rows.push({ kind: "header", id: `h-${group.heading}`, heading: group.heading })
    for (const item of items) {
      rows.push({ kind: "item", id: item.value, item })
    }
  }
  return rows
}

interface ComboboxProps {
  value: string
  onChange: (value: string) => void
  triggerLabel: string
  triggerTag?: string
  groups: ComboboxGroup[]
  placeholder?: string
  filterPlaceholder?: string
  className?: string
}

export function Combobox({
  value,
  onChange,
  triggerLabel,
  triggerTag,
  groups,
  placeholder = "Select model",
  filterPlaceholder = "Filter models…",
  className,
}: ComboboxProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [activeId, setActiveId] = useState<string | null>(value || null)
  const [scrollTop, setScrollTop] = useState(0)
  const [pos, setPos] = useState<{
    top: number
    left: number
    width: number
    side: "top" | "bottom"
  } | null>(null)
  const triggerWrapRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const filterRef = useRef<HTMLInputElement>(null)

  const rows = useMemo(() => flatten(groups, query), [groups, query])
  const selectableIds = useMemo(
    () => rows.filter((r) => r.kind === "item" && !r.item.disabled).map((r) => r.id),
    [rows],
  )

  const updatePosition = () => {
    const trigger = triggerRef.current
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const gap = 4
    const pad = 8
    const maxH = 280
    const spaceBelow = window.innerHeight - rect.bottom - pad
    const spaceAbove = rect.top - pad
    const preferBottom = spaceBelow >= Math.min(maxH, 120) || spaceBelow >= spaceAbove
    const side: "top" | "bottom" = preferBottom ? "bottom" : "top"
    const top = side === "bottom" ? rect.bottom + gap : rect.top - gap
    const width = Math.min(Math.max(rect.width, 300), window.innerWidth - 16)
    const left = Math.min(rect.left, window.innerWidth - width - 8)
    setPos({ top, left: Math.max(8, left), width, side })
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
    const onDoc = (event: MouseEvent) => {
      const t = event.target as Node
      if (triggerWrapRef.current?.contains(t)) return
      if (popoverRef.current?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [open])

  useEffect(() => {
    if (!open) {
      setQuery("")
      setScrollTop(0)
      return
    }
    const id = window.setTimeout(() => filterRef.current?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [open])

  useEffect(() => {
    if (!open) return
    setActiveId((prev) => {
      if (prev && selectableIds.includes(prev)) return prev
      return selectableIds[0] ?? null
    })
  }, [open, selectableIds])

  const commit = (next: string, disabled?: boolean) => {
    if (disabled) return
    onChange(next)
    setOpen(false)
  }

  const moveActive = (delta: number) => {
    if (selectableIds.length === 0) return
    const current = activeId ? selectableIds.indexOf(activeId) : -1
    const next = (current + delta + selectableIds.length) % selectableIds.length
    const id = selectableIds[next] ?? null
    setActiveId(id)
    if (!id || !listRef.current) return
    const rowIndex = rows.findIndex((r) => r.kind === "item" && r.id === id)
    if (rowIndex < 0) return
    const top = rowIndex * MODEL_COMBOBOX_ROW_HEIGHT
    const el = listRef.current
    if (top < el.scrollTop) el.scrollTop = top
    const bottom = top + MODEL_COMBOBOX_ROW_HEIGHT
    if (bottom > el.scrollTop + MODEL_COMBOBOX_VIEWPORT) {
      el.scrollTop = bottom - MODEL_COMBOBOX_VIEWPORT
    }
  }

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape") {
      setOpen(false)
      return
    }
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      setOpen(true)
    }
  }

  const onFilterKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault()
      setOpen(false)
      triggerRef.current?.focus()
      return
    }
    if (event.key === "ArrowDown") {
      event.preventDefault()
      moveActive(1)
      return
    }
    if (event.key === "ArrowUp") {
      event.preventDefault()
      moveActive(-1)
      return
    }
    if (event.key === "Enter") {
      event.preventDefault()
      const row = rows.find((r) => r.kind === "item" && r.id === activeId)
      if (row?.kind === "item") commit(row.item.value, row.item.disabled)
    }
  }

  const viewport = MODEL_COMBOBOX_VIEWPORT
  const start = Math.max(0, Math.floor(scrollTop / MODEL_COMBOBOX_ROW_HEIGHT) - OVERSCAN)
  const end = Math.min(
    rows.length,
    Math.ceil((scrollTop + viewport) / MODEL_COMBOBOX_ROW_HEIGHT) + OVERSCAN,
  )
  const windowRows = rows.slice(start, end)
  const padTop = start * MODEL_COMBOBOX_ROW_HEIGHT
  const padBottom = Math.max(0, (rows.length - end) * MODEL_COMBOBOX_ROW_HEIGHT)

  const popover =
    open && pos && typeof document !== "undefined"
      ? createPortal(
          <div
            ref={popoverRef}
            data-testid="model-combobox-popover"
            data-side={pos.side}
            style={{
              position: "fixed",
              top: pos.side === "bottom" ? pos.top : undefined,
              bottom: pos.side === "top" ? window.innerHeight - pos.top : undefined,
              left: pos.left,
              width: pos.width,
            }}
            className="z-50 overflow-hidden rounded-[8px] border border-[var(--bd)] bg-[var(--bg)] shadow-modal"
          >
            <div className="border-b border-[var(--bd)] p-[6px]">
              <Input
                ref={filterRef}
                variant="compact"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onFilterKeyDown}
                placeholder={filterPlaceholder}
                aria-label="Filter models"
                data-testid="model-combobox-filter"
                className="h-[30px]"
              />
            </div>
            <div
              ref={listRef}
              role="listbox"
              data-testid="model-combobox-list"
              data-virtualized={rows.length > 20 ? "true" : "false"}
              onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
              className="overflow-y-auto py-[4px]"
              style={{ maxHeight: viewport }}
            >
              {rows.length === 0 ? (
                <p className="px-[10px] py-[8px] text-[11px] text-[var(--tx3)]">No models match</p>
              ) : (
                <>
                  <div style={{ height: padTop }} />
                  {windowRows.map((row) =>
                    row.kind === "header" ? (
                      <div
                        key={row.id}
                        role="presentation"
                        className="px-[10px] py-[4px] text-[10px] font-semibold uppercase tracking-[0.04em] text-[var(--tx3)]"
                        style={{ height: MODEL_COMBOBOX_ROW_HEIGHT }}
                      >
                        {row.heading}
                      </div>
                    ) : (
                      <button
                        key={row.id}
                        type="button"
                        role="option"
                        aria-selected={row.item.value === value}
                        aria-disabled={row.item.disabled || undefined}
                        aria-label={
                          row.item.disabled && row.item.hint
                            ? `${row.item.label} (${row.item.tag ?? ""}) — ${row.item.hint}`
                            : `${row.item.label} (${row.item.tag ?? ""})`
                        }
                        disabled={row.item.disabled}
                        onMouseEnter={() => {
                          if (!row.item.disabled) setActiveId(row.id)
                        }}
                        onClick={() => commit(row.item.value, row.item.disabled)}
                        style={{ height: MODEL_COMBOBOX_ROW_HEIGHT }}
                        className={cn(
                          "flex w-full items-center gap-[6px] px-[10px] text-left text-[11px]",
                          row.item.disabled
                            ? "cursor-not-allowed text-[var(--tx3)]"
                            : "text-[var(--tx2)]",
                          !row.item.disabled && activeId === row.id && "bg-[var(--acbg)] text-[var(--tx)]",
                          row.item.value === value && !row.item.disabled && "bg-[var(--bg2)] font-medium text-[var(--tx)]",
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <TruncatedText>{row.item.label}</TruncatedText>
                        </span>
                        {row.item.tag ? (
                          <span className="shrink-0 rounded-[6px] bg-[var(--bg2)] px-[6px] py-[2px] text-[10px] text-[var(--tx2)]">
                            {row.item.tag}
                          </span>
                        ) : null}
                        {row.item.disabled && row.item.hint ? (
                          <span className="shrink-0 text-[10px] text-[var(--warn)]">{row.item.hint}</span>
                        ) : null}
                      </button>
                    ),
                  )}
                  <div style={{ height: padBottom }} />
                </>
              )}
            </div>
          </div>,
          document.body,
        )
      : null

  return (
    <div ref={triggerWrapRef} className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={triggerLabel || placeholder}
        data-testid="model-combobox-trigger"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onTriggerKeyDown}
        className="flex h-[30px] w-full items-center justify-between gap-[6px] rounded-[8px] border border-[var(--bd)] bg-[var(--bg)] px-[8px] text-[11px] text-[var(--tx)] transition-colors hover:border-[var(--bd2)] focus:border-[var(--tx)] focus:outline-none"
      >
        <span className="flex min-w-0 flex-1 items-center gap-[6px]">
          <span className="min-w-0 flex-1">
            <TruncatedText>{triggerLabel || placeholder}</TruncatedText>
          </span>
          {triggerTag ? (
            <span className="shrink-0 rounded-[6px] bg-[var(--bg2)] px-[6px] py-[2px] text-[10px] text-[var(--tx2)]">
              {triggerTag}
            </span>
          ) : null}
        </span>
        <ChevronDown className={cn("h-3 w-3 shrink-0 text-[var(--tx3)] transition-transform", open && "rotate-180")} />
      </button>
      {popover}
    </div>
  )
}
