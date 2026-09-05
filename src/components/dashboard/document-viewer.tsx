"use client"

import type { ReactNode } from "react"
import { Modal } from "@/components/ui/modal"
import { cn } from "@/lib/utils"

export interface DocumentViewerProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
}

export function DocumentViewer({
  open,
  onClose,
  title,
  description,
  actions,
  children,
}: DocumentViewerProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="xl"
      contained
      bodyTestId="document-viewer-body"
      headerActions={
        actions ? (
          <div
            data-testid="document-viewer-actions"
            className="flex shrink-0 flex-wrap items-center justify-end gap-[6px]"
          >
            {actions}
          </div>
        ) : undefined
      }
    >
      <div
        data-testid="document-viewer-prose"
        className={cn(
          "mx-auto w-full max-w-[65ch] min-w-0 text-[13px] leading-[1.6] [overflow-wrap:anywhere]",
          "[&_pre]:max-w-full [&_pre]:min-w-0 [&_pre]:overflow-x-auto",
          "[&_table]:max-w-full",
        )}
      >
        {children}
      </div>
    </Modal>
  )
}
