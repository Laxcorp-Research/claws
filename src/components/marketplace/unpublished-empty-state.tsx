"use client"

import Link from "next/link"
import { EyeOff } from "lucide-react"
import { EmptyState } from "@/components/ui/empty-state"
import { Button } from "@/components/ui/button"

/** Owner-only store empty state for a listing they unpublished. */
export function UnpublishedEmptyState() {
  return (
    <EmptyState
      icon={<EyeOff className="h-10 w-10 text-[var(--tx3)]" aria-hidden="true" />}
      title="Unpublished"
      description="Off the store - no new buyers. People who already installed keep their copy. Publish again from your creator dashboard to submit for review."
      actions={
        <Link href="/settings?tab=creator">
          <Button variant="primary">View in your creator dashboard</Button>
        </Link>
      }
    />
  )
}
