"use client";

import { Modal } from "./modal";
import { Button } from "./button";
import { AlertTriangle } from "lucide-react";

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  warningText?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "warning";
  loading?: boolean;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  warningText,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "danger",
  loading,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{cancelLabel}</Button>
          {variant === "danger" ? (
            <Button variant="danger" onClick={onConfirm} loading={loading}>{confirmLabel}</Button>
          ) : (
            <Button variant="primary" className="bg-[var(--caution)]" onClick={onConfirm} loading={loading}>{confirmLabel}</Button>
          )}
        </>
      }
    >
      {warningText && (
        <div className="bg-[var(--errbg)] rounded-[6px] py-2 px-2.5 text-[11px] text-[#991b1b] mb-3 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 text-[var(--err)] shrink-0" aria-hidden="true" />
          {warningText}
        </div>
      )}
    </Modal>
  );
}
