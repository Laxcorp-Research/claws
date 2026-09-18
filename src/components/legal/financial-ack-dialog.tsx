"use client"

import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import {
  FINANCIAL_ACK_BODY,
  FINANCIAL_ACK_LABEL,
  TERMS_SECTION_8_URL,
} from "@/lib/legal/consent"

/**
 * First deploy of a financial template: §8 acknowledgement. The deploy route
 * returns FINANCIAL_TERMS_ACK_REQUIRED (428) until the client retries with
 * { financialAckAccepted: true }; the confirmation is stored server-side as
 * a ConsentRecord (kind FINANCIAL_AUTONOMY_S8).
 */
export function FinancialAckDialog({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <ConfirmDialog
      open={open}
      onClose={onClose}
      onConfirm={onConfirm}
      title="AI & autonomy terms"
      description={FINANCIAL_ACK_BODY}
      confirmLabel={FINANCIAL_ACK_LABEL}
      cancelLabel="Cancel"
      variant="warning"
    >
      <p className="text-[11px] text-[var(--tx3)]">
        Read the{" "}
        <a
          href={TERMS_SECTION_8_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 text-[var(--ac-text)] hover:text-[var(--tx)]"
        >
          AI &amp; autonomy terms (§8)
        </a>{" "}
        before deploying.
      </p>
    </ConfirmDialog>
  )
}
