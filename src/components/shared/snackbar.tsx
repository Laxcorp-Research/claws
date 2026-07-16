"use client"

/**
 * Platform Snackbar — single-slot bottom feedback for instant mutations.
 * See docs/DESIGN_SYSTEM.md § Snackbar.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"

export type SnackbarVariant = "success" | "info" | "undo-action"

export interface SnackbarShowOptions {
  message: string
  variant?: SnackbarVariant
  /** When set, renders Undo and uses undo-action chrome unless variant overridden. */
  onUndo?: () => void | Promise<void>
  /** Auto-dismiss ms; default 8000. */
  durationMs?: number
}

interface SnackbarContextValue {
  show: (options: SnackbarShowOptions) => void
  dismiss: () => void
}

const SnackbarContext = createContext<SnackbarContextValue | null>(null)

const DEFAULT_DURATION_MS = 8000

interface ActiveSnackbar {
  id: number
  message: string
  variant: SnackbarVariant
  onUndo?: () => void | Promise<void>
  durationMs: number
}

export function SnackbarProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<ActiveSnackbar | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const idRef = useRef(0)

  const dismiss = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setActive(null)
  }, [])

  const show = useCallback(
    (options: SnackbarShowOptions) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      const variant: SnackbarVariant =
        options.variant ?? (options.onUndo ? "undo-action" : "success")
      const durationMs = options.durationMs ?? DEFAULT_DURATION_MS
      const id = ++idRef.current
      setActive({
        id,
        message: options.message,
        variant,
        onUndo: options.onUndo,
        durationMs,
      })
      timerRef.current = setTimeout(() => {
        setActive((current) => (current?.id === id ? null : current))
        timerRef.current = null
      }, durationMs)
    },
    [],
  )

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  return (
    <SnackbarContext.Provider value={{ show, dismiss }}>
      {children}
      <SnackbarHost active={active} onDismiss={dismiss} />
    </SnackbarContext.Provider>
  )
}

export function useSnackbar(): SnackbarContextValue {
  const ctx = useContext(SnackbarContext)
  if (!ctx) {
    throw new Error("useSnackbar must be used within SnackbarProvider")
  }
  return ctx
}

/** Optional hook for surfaces that may render outside the provider in tests. */
export function useSnackbarOptional(): SnackbarContextValue | null {
  return useContext(SnackbarContext)
}

function SnackbarHost({
  active,
  onDismiss,
}: {
  active: ActiveSnackbar | null
  onDismiss: () => void
}) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted || !active || typeof document === "undefined") return null

  return createPortal(
    <div
      role="status"
      aria-live="polite"
      data-testid="snackbar"
      data-variant={active.variant}
      className={cn(
        "fixed bottom-[20px] left-1/2 z-[100] -translate-x-1/2",
        "flex max-w-[420px] items-center gap-[10px]",
        "rounded-[8px] border border-[var(--bd)] bg-[var(--tx)] px-[14px] py-[10px]",
        "text-[12px] font-medium text-white shadow-modal",
      )}
    >
      <span className="min-w-0 flex-1 leading-[1.4]">{active.message}</span>
      {active.onUndo && (
        <button
          type="button"
          className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--ac)] hover:underline"
          onClick={async () => {
            const undo = active.onUndo
            onDismiss()
            if (undo) await undo()
          }}
        >
          Undo
        </button>
      )}
      <button
        type="button"
        aria-label="Dismiss"
        className="shrink-0 text-[14px] leading-none text-white/70 hover:text-white"
        onClick={onDismiss}
      >
        ×
      </button>
    </div>,
    document.body,
  )
}
