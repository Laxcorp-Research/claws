"use client"

import { useRef, useState, useCallback, useEffect, useLayoutEffect } from "react"
import { Tooltip } from "./tooltip"
import { cn } from "@/lib/utils"

interface TruncatedTextProps {
  children: string
  className?: string
  as?: "span" | "div" | "p" | "td"
}

const TRUNCATION_TOLERANCE_PX = 1

/**
 * Ephemeral measuring span (never ellipsized) vs container content-box width.
 * Tolerance 1px. Span is created, measured, and removed - not kept in the React
 * tree (a permanent sibling duplicated visible text and broke getByText suites).
 *
 * HISTORY: #293 / SS2 forced always-on tips because detection read Chromium's
 * ellipsized-node metrics (`scrollWidth === clientWidth` while ellipsis painted).
 * The measuring span never gets `text-overflow: ellipsis`, so that failure mode
 * is gone - tips gate on this detector again.
 *
 * MUTATION: force always-false → truncated-tip specs fail;
 * force always-true → no-tip-on-fitting specs fail.
 */
export function measureTruncation(
  text: string,
  containerEl: HTMLElement,
  fontSourceEl: HTMLElement,
): boolean {
  const cs = getComputedStyle(containerEl)
  const padX =
    (Number.parseFloat(cs.paddingLeft) || 0) + (Number.parseFloat(cs.paddingRight) || 0)
  const contentBoxWidth = containerEl.clientWidth - padX
  if (contentBoxWidth <= 0) return false

  const fontCs = getComputedStyle(fontSourceEl)
  const measure = document.createElement("span")
  measure.setAttribute("aria-hidden", "true")
  measure.style.cssText = [
    "position:absolute",
    "left:-99999px",
    "top:0",
    "visibility:hidden",
    "pointer-events:none",
    "white-space:nowrap",
    "height:auto",
    "width:auto",
    "max-width:none",
    "min-width:0",
    "overflow:visible",
    "text-overflow:clip",
    `font:${fontCs.font}`,
    `letter-spacing:${fontCs.letterSpacing}`,
    `text-transform:${fontCs.textTransform}`,
  ].join(";")
  measure.textContent = text
  document.body.appendChild(measure)
  const naturalWidth = measure.offsetWidth
  document.body.removeChild(measure)
  return naturalWidth > contentBoxWidth + TRUNCATION_TOLERANCE_PX
}

/** @deprecated Prefer measureTruncation(text, container, fontSource). */
export function isTextTruncated(el: HTMLElement): boolean {
  if (el.clientWidth <= 0) return false
  if (Math.ceil(el.scrollWidth) - Math.floor(el.clientWidth) > 0) return true
  return false
}

export function TruncatedText({
  children,
  className,
  as: Tag = "span",
}: TruncatedTextProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const textRef = useRef<HTMLElement>(null)
  // SSR-safe: no tip until first client measure completes.
  const [measured, setMeasured] = useState(false)
  const [isOverflowing, setIsOverflowing] = useState(false)

  const checkOverflow = useCallback(() => {
    const wrap = wrapRef.current
    const textEl = textRef.current
    if (!wrap || !textEl) return
    if (wrap.clientWidth === 0) {
      setIsOverflowing(false)
      setMeasured(true)
      return
    }
    setIsOverflowing(measureTruncation(children, wrap, textEl))
    setMeasured(true)
  }, [children])

  useLayoutEffect(() => {
    checkOverflow()
  }, [checkOverflow])

  useEffect(() => {
    let raf = 0
    let cancelled = false
    const schedule = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        if (!cancelled) checkOverflow()
      })
    }

    const wrap = wrapRef.current
    const observer =
      typeof ResizeObserver !== "undefined" && wrap
        ? new ResizeObserver(schedule)
        : null
    if (wrap) observer?.observe(wrap)

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
      window.removeEventListener("resize", schedule)
      fonts?.removeEventListener?.("loadingdone", onFonts)
    }
  }, [checkOverflow])

  const textClassName = cn(
    "block max-w-full min-w-0 overflow-hidden text-ellipsis whitespace-nowrap",
    className,
  )

  const element = (
    <Tag
      ref={textRef as React.Ref<never>}
      data-truncated={measured ? (isOverflowing ? "true" : "false") : undefined}
      className={textClassName}
    >
      {children}
    </Tag>
  )

  // Tip ONLY when truncated (post-measure). Fitting names never tip.
  const showTip = measured && isOverflowing

  return (
    <div ref={wrapRef} className="relative block w-full min-w-0 max-w-full">
      {showTip ? (
        <Tooltip
          content={children}
          maxWidth={400}
          align="center"
          // Anchor = text box: content-sized up to container (not unconditional w-full).
          // MUTATION: restore w-full-only trigger → centerOffset/contact specs fail.
          triggerClassName="inline-block w-max max-w-full min-w-0"
        >
          {element}
        </Tooltip>
      ) : (
        element
      )}
    </div>
  )
}

export const TruncateWithTooltip = TruncatedText
