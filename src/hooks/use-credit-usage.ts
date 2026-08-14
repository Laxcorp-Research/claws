"use client"

import { useState, useEffect, useCallback } from "react"

export type CreditProvider =
  | "ANTHROPIC"
  | "OPENAI"
  | "GOOGLE"
  | "OPENROUTER"
  | "OLLAMA"

export interface CreditUsageRecord {
  id: string
  creditAccountId: string
  workspaceId: string
  workspaceName: string | null
  agentId: string | null
  provider: CreditProvider
  model: string
  inputTokens: number
  outputTokens: number
  costCents: number
  balanceAfterCents: number
  createdAt: string
}

export interface CreditUsageDaily {
  id: string
  creditAccountId: string
  workspaceId: string
  date: string
  provider: CreditProvider
  model: string
  totalCalls: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCostCents: number
}

interface CreditUsage {
  records: CreditUsageRecord[]
  daily: CreditUsageDaily[]
}

const EMPTY: CreditUsage = { records: [], daily: [] }

export function useCreditUsage() {
  const [data, setData] = useState<CreditUsage>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/credits/usage")
      const json = await res.json()
      if (json.success) {
        setData({
          records: Array.isArray(json.data?.records) ? json.data.records : [],
          daily: Array.isArray(json.data?.daily) ? json.data.daily : [],
        })
      } else {
        setError(json.error?.message || "Failed to fetch credit usage")
      }
    } catch {
      setError("Failed to fetch credit usage")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refetch()
  }, [refetch])

  return { ...data, loading, error, refetch }
}
