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

const EMPTY_ITEMS: never[] = []

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

  const { category, priceFilter, sort, search } = filters
  const { type, section, initialLimit = 20, enabled = true } = options

  const buildUrl = useCallback(
    (cursor?: string) => {
      const endpoint = type === "templates"
        ? "/api/marketplace/templates"
        : "/api/marketplace/skills"

      const params = new URLSearchParams()
      if (category) params.set("category", category)
      if (priceFilter === "free") params.set("isFree", "true")
      if (priceFilter === "paid") params.set("isFree", "false")
      if (sort) params.set("sort", sort)
      if (search) params.set("search", search)
      if (section) params.set("section", section)
      if (cursor) params.set("cursor", cursor)
      params.set("limit", String(initialLimit))

      return `${endpoint}?${params.toString()}`
    },
    [category, priceFilter, sort, search, type, section, initialLimit]
  )

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false)
      setItems(EMPTY_ITEMS)
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
        setItems(payload.items ?? EMPTY_ITEMS)
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
  }, [buildUrl, enabled])

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
