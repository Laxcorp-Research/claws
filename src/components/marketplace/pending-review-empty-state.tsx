"use client"

import Link from "next/link"
import { Clock } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"

/** Owner-only store empty state for a listing that is still PENDING review. */
export function PendingReviewEmptyState() {
  return (
    <EmptyState
      icon={<Clock className="h-10 w-10 text-[var(--tx3)]" aria-hidden="true" />}
      title="Pending review"
      description="Submitted for review — you'll get an email when it's approved."
      actions={
        <Link href="/settings?tab=creator">
          <Button variant="primary">View in your creator dashboard</Button>
        </Link>
      }
    />
  )
}
