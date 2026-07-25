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
 * Compare natural text width (hidden measuring span — never ellipsized) to the
 * container content-box width. Tolerance 1px.
 *
 * HISTORY: #293 / SS2 forced always-on tips because detection read Chromium's
 * ellipsized-node metrics (`scrollWidth === clientWidth` while ellipsis painted).
 * The measuring span never gets `text-overflow: ellipsis`, so that failure mode
 * is gone — tips gate on this detector again.
 *
 * MUTATION: force always-false → truncated-tip specs fail;
 * force always-true → no-tip-on-fitting specs fail.
 */
export function measureTruncation(
  measureEl: HTMLElement,
  containerEl: HTMLElement,
): boolean {
  const cs = getComputedStyle(containerEl)
  const padX =
    (Number.parseFloat(cs.paddingLeft) || 0) + (Number.parseFloat(cs.paddingRight) || 0)
  const contentBoxWidth = containerEl.clientWidth - padX
  if (contentBoxWidth <= 0) return false
  const naturalWidth = measureEl.offsetWidth
  return naturalWidth > contentBoxWidth + TRUNCATION_TOLERANCE_PX
}

/** @deprecated Use measureTruncation — kept for call-site greps during migration. */
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
  const measureRef = useRef<HTMLSpanElement>(null)
  const textRef = useRef<HTMLElement>(null)
  // SSR-safe: no tip until first client measure completes.
  const [measured, setMeasured] = useState(false)
  const [isOverflowing, setIsOverflowing] = useState(false)

  const checkOverflow = useCallback(() => {
    const measure = measureRef.current
    const wrap = wrapRef.current
    if (!measure || !wrap) return
    if (wrap.clientWidth === 0) {
      setIsOverflowing(false)
      setMeasured(true)
      return
    }
    setIsOverflowing(measureTruncation(measure, wrap))
    setMeasured(true)
  }, [])

  useLayoutEffect(() => {
    checkOverflow()
  }, [checkOverflow, children])

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
  }, [checkOverflow, children])

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
      {/* Hidden measuring span — natural width, never ellipsized. */}
      <span
        ref={measureRef}
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 whitespace-nowrap"
        style={{ visibility: "hidden", height: "auto", width: "auto", maxWidth: "none" }}
      >
        <span className={cn(className, "whitespace-nowrap")}>{children}</span>
      </span>

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
