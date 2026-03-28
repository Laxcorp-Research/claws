"use client"

import { useEffect } from "react"
import { NetworkError } from "@/components/shared/network-error"

export default function BuilderError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("Builder error:", error)
  }, [error])

  return (
    <div className="flex items-center justify-center h-screen bg-[var(--bg)]">
      <NetworkError
        message="Failed to load the builder. The workspace may not exist or there was a server error."
        onRetry={reset}
      />
    </div>
  )
}
