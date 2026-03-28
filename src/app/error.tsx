"use client"

import { useEffect } from "react"
import { NetworkError } from "@/components/shared/network-error"

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("Unhandled error:", error)
  }, [error])

  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--bg)]">
      <NetworkError
        message="An unexpected error occurred. Our team has been notified."
        onRetry={reset}
      />
    </div>
  )
}
