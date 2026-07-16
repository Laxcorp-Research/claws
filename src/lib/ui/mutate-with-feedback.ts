/**
 * Instant-mutation feedback guard.
 *
 * Any mutation that applies instantly without navigation, dialog, or
 * inline state change MUST route through this helper so a Snackbar fires.
 *
 * Failure honesty: if `op` throws (including non-2xx after the caller
 * checks `res.ok`), shows an error-variant Snackbar with no Undo and
 * rethrows so callers do not apply optimistic success state.
 */
import type { SnackbarShowOptions } from "@/components/shared/snackbar"

export type MutateFeedbackShow = (options: SnackbarShowOptions) => void

export interface MutateWithFeedbackOptions {
  message: string
  /** Shown on failure; defaults to Error.message or a generic fallback. */
  errorMessage?: string
  /** When provided, Snackbar shows Undo (undo-action variant). */
  undo?: () => void | Promise<void>
  variant?: SnackbarShowOptions["variant"]
  durationMs?: number
}

/**
 * Run an async mutation, then show a success Snackbar.
 * On failure: error Snackbar (no undo), then rethrow.
 */
export async function mutateWithFeedback(
  op: () => Promise<void>,
  options: MutateWithFeedbackOptions,
  show: MutateFeedbackShow,
): Promise<void> {
  try {
    await op()
  } catch (err) {
    const message =
      options.errorMessage ??
      (err instanceof Error && err.message.trim().length > 0
        ? err.message
        : "Something went wrong")
    show({
      message,
      variant: "error",
    })
    throw err
  }

  show({
    message: options.message,
    variant: options.variant ?? (options.undo ? "undo-action" : "success"),
    onUndo: options.undo,
    durationMs: options.durationMs,
  })
}
