"use client"

import { useEffect } from "react"
import { NetworkError } from "@/components/shared/network-error"

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("Dashboard error:", error)
  }, [error])

  return (
    <div className="max-w-5xl mx-auto px-5 py-16">
      <NetworkError
        message="Failed to load the dashboard. This workspace may not exist or there was a server error."
        onRetry={reset}
      />
    </div>
  )
}
