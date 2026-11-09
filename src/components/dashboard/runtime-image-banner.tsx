"use client"

import { useEffect, useState } from "react"
import { AlertBanner } from "@/components/ui/alert-banner"
import { RUNTIME_IMAGE_MISSING_BANNER } from "@/lib/openclaw/runtime-image-message"

export function useRuntimeImageMissing(): boolean {
  const [missing, setMissing] = useState(false)
  useEffect(() => {
    let cancelled = false
    fetch("/api/health")
      .then((res) => res.json())
      .then((json: { runtimeImage?: { present?: boolean } }) => {
        if (!cancelled) setMissing(json?.runtimeImage?.present === false)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])
  return missing
}

export function RuntimeImageBanner({ missing }: { missing: boolean }) {
  if (!missing) return null
  return (
    <AlertBanner variant="warning">
      <p className="font-medium">{RUNTIME_IMAGE_MISSING_BANNER}</p>
    </AlertBanner>
  )
}
