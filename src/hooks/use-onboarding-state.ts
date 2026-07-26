"use client"

import { useCallback, useEffect, useState } from "react"
import { shouldShowGettingStartedNav } from "@/lib/onboarding/tracker-state"

type Steps = { s1: boolean; s2: boolean; s3: boolean }

const CACHE_TTL_MS = 60_000
let cache: { at: number; steps: Steps } | null = null
const listeners = new Set<() => void>()

export function invalidateOnboardingStateCache(): void {
  cache = null
  listeners.forEach((l) => l())
}

async function fetchSteps(): Promise<Steps | null> {
  try {
    const res = await fetch("/api/onboarding/state")
    if (!res.ok) return null
    const json = (await res.json()) as { success?: boolean; data?: Steps }
    if (!json.success || !json.data) return null
    return json.data
  } catch {
    return null
  }
}

/**
 * SWR-style cache (~60s) + revalidate-on-focus for top-bar nav visibility.
 * Eventual consistency is acceptable — no per-navigation DB reads.
 */
export function useOnboardingNavVisible(enabled: boolean): boolean {
  const [steps, setSteps] = useState<Steps | null>(cache?.steps ?? null)

  const load = useCallback(async (force = false) => {
    if (!enabled) return
    const fresh = cache && Date.now() - cache.at < CACHE_TTL_MS
    if (!force && fresh && cache) {
      setSteps(cache.steps)
      return
    }
    const next = await fetchSteps()
    if (!next) return
    cache = { at: Date.now(), steps: next }
    setSteps(next)
  }, [enabled])

  useEffect(() => {
    if (!enabled) return
    void load(false)
    const onInvalidate = () => void load(true)
    listeners.add(onInvalidate)
    const onFocus = () => void load(true)
    window.addEventListener("focus", onFocus)
    return () => {
      listeners.delete(onInvalidate)
      window.removeEventListener("focus", onFocus)
    }
  }, [enabled, load])

  if (!enabled || !steps) return false
  return shouldShowGettingStartedNav({
    s1Done: steps.s1,
    s2Done: steps.s2,
    s3Done: steps.s3,
  })
}
