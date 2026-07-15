"use client"

import { useRef, useState, useCallback, useEffect } from "react"
import { Tooltip } from "./tooltip"
import { cn } from "@/lib/utils"

interface TruncatedTextProps {
  children: string
  className?: string
  as?: "span" | "div" | "p" | "td"
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
    // Stop at a fixed-width box — further ancestors don't change our text width.
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
    // display:none / not laid out yet — do not lock in "not truncated".
    if (el.clientWidth === 0) {
      setIsOverflowing(false)
      return
    }
    setIsOverflowing(el.scrollWidth > el.clientWidth)
  }, [])

  useEffect(() => {
    let raf = 0
    let cancelled = false
    // Post-layout remeasure: sync useEffect can run before the constrained
    // parent has a final width. Double-rAF + ResizeObserver on the text node
    // AND constrained ancestors + font load cover the Live Ops tile path.
    // MUTATION: drop the rAF schedule / only measure synchronously → overflow
    // detection flakes and truncation tests fail.
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
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(schedule)
        : null
    for (const t of targets) observer?.observe(t)

    // hidden attribute / style toggles (dashboard tabs use `hidden={...}`).
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

    // Font swap can widen glyphs without changing the constraint box size —
    // ResizeObserver alone would miss it (founder Live Ops miss).
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

  // Stable outer + Tooltip trigger (disabled when not truncated) so overflow
  // remounts do not collapse width via inline-flex content sizing.
  return (
    <div ref={wrapRef} className="block w-full min-w-0 max-w-full">
      <Tooltip content={children} maxWidth={400} disabled={!isOverflowing}>
        {element}
      </Tooltip>
    </div>
  )
}

export const TruncateWithTooltip = TruncatedText
