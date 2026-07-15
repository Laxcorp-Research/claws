"use client"

import { useRef, useState, useCallback, useEffect } from "react"
import { Tooltip } from "./tooltip"
import { cn } from "@/lib/utils"

interface TruncatedTextProps {
  children: string
  className?: string
  as?: "span" | "div" | "p" | "td"
}

/**
 * Best-effort overflow signal for `data-truncated` / tests.
 * NOT used to gate the tooltip — Chromium can paint ellipsis while
 * scrollWidth === clientWidth (founder: Engagement tips, Trend & Topic does not).
 */
export function isTextTruncated(el: HTMLElement): boolean {
  if (el.clientWidth <= 0) return false
  if (Math.ceil(el.scrollWidth) - Math.floor(el.clientWidth) > 0) return true

  // Unconstrained clone uses the live computed font (canvas underestimates
  // webfonts and left Trend & Topic as a false-negative).
  const cs = window.getComputedStyle(el)
  const clone = el.cloneNode(true) as HTMLElement
  clone.style.cssText = [
    "position:absolute",
    "left:-99999px",
    "top:0",
    "visibility:hidden",
    "pointer-events:none",
    "height:auto",
    "width:auto",
    "max-width:none",
    "min-width:0",
    "overflow:visible",
    "text-overflow:clip",
    "white-space:nowrap",
    `font:${cs.font}`,
    `letter-spacing:${cs.letterSpacing}`,
    `text-transform:${cs.textTransform}`,
  ].join(";")
  document.body.appendChild(clone)
  const full = clone.offsetWidth
  document.body.removeChild(clone)
  return full > el.clientWidth + 0.5
}

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

  // ALWAYS_TIP_ASSERT: never gate TruncatedText tooltips on overflow detection.
  // Detection false-negatives left Trend & Topic without a tip while Engagement
  // Strategist tipped on the same Live Ops grid (founder SS1/SS2).
  return (
    <div ref={wrapRef} className="block w-full min-w-0 max-w-full">
      <Tooltip content={children} maxWidth={400} disabled={false}>
        {element}
      </Tooltip>
    </div>
  )
}

export const TruncateWithTooltip = TruncatedText
