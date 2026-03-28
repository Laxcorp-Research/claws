"use client"

import { useEffect } from "react"
import { NetworkError } from "@/components/shared/network-error"

export default function SetupError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("Setup error:", error)
  }, [error])

  return (
    <div className="max-w-3xl mx-auto px-4 py-16">
      <NetworkError
        message="Failed to load the setup page. Please check your connection and try again."
        onRetry={reset}
      />
    </div>
  )
}
