"use client"

import { useState, useEffect, useCallback } from "react"

interface CreditBalance {
  hasCredits: boolean
  balanceCents: number
  totalConsumedCents: number
  initialGrantCents: number
  status: "ACTIVE" | "EXHAUSTED" | "SUSPENDED" | "CONVERTED" | null
  grantedAt: string | null
  exhaustedAt: string | null
}

const EMPTY: CreditBalance = {
  hasCredits: false,
  balanceCents: 0,
  totalConsumedCents: 0,
  initialGrantCents: 0,
  status: null,
  grantedAt: null,
  exhaustedAt: null,
}

export function useCreditBalance(pollIntervalMs?: number) {
  const [data, setData] = useState<CreditBalance>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refetch = useCallback(async () => {
    try {
      const res = await fetch("/api/credits/balance")
      const json = await res.json()
      if (json.success) {
        // PR-7: spread over EMPTY so a partial API response (e.g. the
        // no-account branch returns only {hasCredits,balanceCents,status})
        // can't leave numeric fields undefined → downstream formatters got
        // `undefined/100 = NaN` ("$NaN" on the Usage page). Every consumer
        // now gets fully-shaped data with zeroed numerics.
        setData({ ...EMPTY, ...json.data })
      } else {
        setError(json.error?.message || "Failed to fetch credit balance")
      }
    } catch {
      setError("Failed to fetch credit balance")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refetch()

    if (pollIntervalMs && pollIntervalMs > 0) {
      const interval = setInterval(refetch, pollIntervalMs)
      return () => clearInterval(interval)
    }
  }, [refetch, pollIntervalMs])

  return { ...data, loading, error, refetch }
}
