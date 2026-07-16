/**
 * Instant-mutation feedback guard (tool customization PR-3).
 *
 * Any mutation that applies instantly without navigation, dialog, or
 * inline state change MUST route through this helper so a Snackbar fires.
 */
import type { SnackbarShowOptions } from "@/components/shared/snackbar"

export type MutateFeedbackShow = (options: SnackbarShowOptions) => void

export interface MutateWithFeedbackOptions {
  message: string
  /** When provided, Snackbar shows Undo (undo-action variant). */
  undo?: () => void | Promise<void>
  variant?: SnackbarShowOptions["variant"]
  durationMs?: number
}

/**
 * Run an async mutation, then show a Snackbar.
 * On mutation failure, rethrows without showing success feedback.
 */
export async function mutateWithFeedback(
  op: () => Promise<void>,
  options: MutateWithFeedbackOptions,
  show: MutateFeedbackShow,
): Promise<void> {
  await op()
  show({
    message: options.message,
    variant: options.variant ?? (options.undo ? "undo-action" : "success"),
    onUndo: options.undo,
    durationMs: options.durationMs,
  })
}
