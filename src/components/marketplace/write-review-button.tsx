"use client"

import { Button } from "@/components/ui/button"

interface WriteReviewButtonProps {
  onClick: () => void
  className?: string
}

/**
 * Store Reviews empty-state CTA. Outline on this surface is transparent +
 * --tx2 on a --bd hairline — it reads as a gray label, not a control.
 * Filled DS primary (default 11px) matches other empty-state actions.
 */
export function WriteReviewButton({ onClick, className }: WriteReviewButtonProps) {
  return (
    <Button
      type="button"
      variant="primary"
      data-testid="write-review-cta"
      className={className}
      onClick={onClick}
    >
      Write a review
    </Button>
  )
}
