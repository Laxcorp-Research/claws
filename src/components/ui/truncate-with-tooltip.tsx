"use client"

import { useRef, useState, useCallback, useEffect } from "react"
import { Tooltip } from "./tooltip"
import { cn } from "@/lib/utils"

interface TruncatedTextProps {
  children: string
  className?: string
  as?: "span" | "div" | "p" | "td"
}

let measureCanvas: HTMLCanvasElement | null = null

/**
 * True when single-line ellipsis is active.
 *
 * Chromium can paint `text-overflow: ellipsis` while reporting
 * `scrollWidth === clientWidth` (founder SS1 Social Content OK / SS2 Trend & Topic
 * no tip). Canvas text-width is the fallback that closes that false-negative.
 */
export function isTextTruncated(el: HTMLElement): boolean {
  if (el.clientWidth <= 0) return false
  // Subpixel-safe primary signal.
  if (Math.ceil(el.scrollWidth) - Math.floor(el.clientWidth) > 0) return true

  const text = el.textContent ?? ""
  if (!text) return false
  try {
    if (!measureCanvas) measureCanvas = document.createElement("canvas")
    const ctx = measureCanvas.getContext("2d")
    if (!ctx) return false
    const cs = window.getComputedStyle(el)
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
    const letterSpacing = Number.parseFloat(cs.letterSpacing)
    const measured = ctx.measureText(text).width
    const spacing =
      Number.isFinite(letterSpacing) && text.length > 1
        ? letterSpacing * (text.length - 1)
        : 0
    return measured + spacing > el.clientWidth + 0.5
  } catch {
    return false
  }
}

/** Nearest layout ancestor that can constrain width (flex/grid min-size or overflow). */
function constraintAncestors(start: HTMLElement | null): HTMLElement[] {
  const out: HTMLElement[] = []
  let node: HTMLElement | null = start?.parentElement ?? null
  while (node && node !== document.body) {
    const style = window.getComputedStyle(node)
    const constrains =
      node.classList.contains("min-w-0") ||
      style.minWidth === "0px" ||
      style.overflowX === "hidden" ||
      style.overflow === "hidden" ||
      style.display.includes("flex") ||
      style.display.includes("grid")
    if (constrains) out.push(node)
    if (style.width.endsWith("px") && node.clientWidth > 0 && !style.display.includes("flex")) {
      break
    }
    node = node.parentElement
  }
  return out
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
    if (el.clientWidth === 0) {
      setIsOverflowing(false)
      return
    }
    setIsOverflowing(isTextTruncated(el))
  }, [])

  // HOVER_REMEASURE_ASSERT: tooltip gating must call isTextTruncated live on
  // enter — never rely solely on stale ResizeObserver state (SS2 miss).
  const isDisabledForTooltip = useCallback(() => {
    const el = textRef.current
    if (!el || el.clientWidth === 0) return true
    const truncated = isTextTruncated(el)
    setIsOverflowing(truncated)
    return !truncated
  }, [])

  useEffect(() => {
    let raf = 0
    let cancelled = false
    const schedule = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame(() => {
          if (!cancelled) checkOverflow()
        })
      })
    }

    schedule()

    const wrap = wrapRef.current
    const text = textRef.current
    const targets = new Set<Element>()
    if (wrap) targets.add(wrap)
    if (text) targets.add(text)
    for (const a of constraintAncestors(text)) targets.add(a)

    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(schedule) : null
    for (const t of targets) observer?.observe(t)

    const mutation =
      typeof MutationObserver !== "undefined" && wrap
        ? new MutationObserver(schedule)
        : null
    if (wrap) {
      let node: HTMLElement | null = wrap
      while (node && node !== document.body) {
        mutation?.observe(node, {
          attributes: true,
          attributeFilter: ["hidden", "style", "class"],
        })
        node = node.parentElement
      }
    }

    window.addEventListener("resize", schedule)
    const fonts = document.fonts
    const onFonts = () => schedule()
    fonts?.addEventListener?.("loadingdone", onFonts)
    void fonts?.ready?.then(() => {
      if (!cancelled) schedule()
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      observer?.disconnect()
      mutation?.disconnect()
      window.removeEventListener("resize", schedule)
      fonts?.removeEventListener?.("loadingdone", onFonts)
    }
  }, [checkOverflow, children])

  const element = (
    <Tag
      ref={textRef as React.Ref<never>}
      data-truncated={isOverflowing ? "true" : "false"}
      className={cn(
        "block w-full min-w-0 max-w-full overflow-hidden text-ellipsis whitespace-nowrap",
        className,
      )}
    >
      {children}
    </Tag>
  )

  return (
    <div ref={wrapRef} className="block w-full min-w-0 max-w-full">
      <Tooltip content={children} maxWidth={400} disabled={isDisabledForTooltip}>
        {element}
      </Tooltip>
    </div>
  )
}

export const TruncateWithTooltip = TruncatedText
