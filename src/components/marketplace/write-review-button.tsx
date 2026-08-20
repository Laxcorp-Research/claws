"use client"

import { Button } from "@/components/ui/button"

interface WriteReviewButtonProps {
  onClick: () => void
  className?: string
}

/**
 * Store Reviews secondary CTA. Uses the DS default Button size (11px), never
 * `sm` (10px) — `sm` read as a footnote under Reviews empty copy.
 */
export function WriteReviewButton({ onClick, className }: WriteReviewButtonProps) {
  return (
    <Button
      type="button"
      variant="outline"
      data-testid="write-review-cta"
      className={className}
      onClick={onClick}
    >
      Write a review
    </Button>
  )
}
