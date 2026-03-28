"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import type { MarketplaceFilters } from "@/types/marketplace"

interface UseMarketplaceOptions {
  type: "templates" | "skills"
  section?: "official" | "trending" | "new"
  initialLimit?: number
  enabled?: boolean
}

interface UseMarketplaceResult<T> {
  items: T[]
  isLoading: boolean
  error: string | null
  nextCursor: string | null
  totalCount: number
  loadMore: () => void
  isLoadingMore: boolean
}

export function useMarketplace<T>(
  filters: MarketplaceFilters,
  options: UseMarketplaceOptions
): UseMarketplaceResult<T> {
  const [items, setItems] = useState<T[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [totalCount, setTotalCount] = useState(0)
  const abortRef = useRef<AbortController | null>(null)

  const buildUrl = useCallback(
    (cursor?: string) => {
      const endpoint = options.type === "templates"
        ? "/api/marketplace/templates"
        : "/api/marketplace/skills"

      const params = new URLSearchParams()
      if (filters.category) params.set("category", filters.category)
      if (filters.priceFilter === "free") params.set("isFree", "true")
      if (filters.priceFilter === "paid") params.set("isFree", "false")
      if (filters.sort) params.set("sort", filters.sort)
      if (filters.search) params.set("search", filters.search)
      if (options.section) params.set("section", options.section)
      if (cursor) params.set("cursor", cursor)
      params.set("limit", String(options.initialLimit ?? 20))

      return `${endpoint}?${params.toString()}`
    },
    [filters, options.type, options.section, options.initialLimit]
  )

  useEffect(() => {
    if (options.enabled === false) {
      setIsLoading(false)
      setItems([])
      return
    }

    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setIsLoading(true)
    setError(null)

    fetch(buildUrl(), { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((json) => {
        const payload = json.data ?? json
        setItems(payload.items ?? [])
        setNextCursor(payload.nextCursor ?? null)
        setTotalCount(payload.totalCount ?? 0)
        setIsLoading(false)
      })
      .catch((err) => {
        if (err.name === "AbortError") return
        setError("Failed to load. Please try again.")
        setIsLoading(false)
      })

    return () => controller.abort()
  }, [buildUrl, options.enabled])

  const loadMore = useCallback(() => {
    if (!nextCursor || isLoadingMore) return

    setIsLoadingMore(true)

    fetch(buildUrl(nextCursor))
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((json) => {
        const payload = json.data ?? json
        setItems((prev) => [...prev, ...(payload.items ?? [])])
        setNextCursor(payload.nextCursor ?? null)
        setIsLoadingMore(false)
      })
      .catch(() => {
        setIsLoadingMore(false)
      })
  }, [nextCursor, isLoadingMore, buildUrl])

  return { items, isLoading, error, nextCursor, totalCount, loadMore, isLoadingMore }
}
