"use client"

import { useEffect, useState } from "react"
import { MODEL_CATALOG_MAX_LIMIT } from "@/lib/models/catalog-limits"
import { providerLabel } from "@/lib/models/provider-labels"
import { resolveCatalogDisplayName } from "@/lib/models/humanize"

export type ModelCatalogOption = {
  value: string
  label: string
  provider: string
  providerKey: string
  isPinned: boolean
  contextLength: number | null
  pricingSnippet: string | null
  costPer1kEst: number | null
  /** true/false from provider metadata; null = unknown (control stays enabled). */
  supportsReasoning: boolean | null
}

let cache: ModelCatalogOption[] | null = null
let inflight: Promise<ModelCatalogOption[]> | null = null

export function resetModelCatalogCache(): void {
  cache = null
  inflight = null
}

function parseCatalog(json: unknown): ModelCatalogOption[] {
  const root = json as { data?: unknown; models?: unknown; options?: unknown }
  const payload = (root.data ?? root) as {
    models?: Array<{
      modelId: string
      displayName?: string
      provider: string
      isPinned?: boolean
      contextLength?: number | null
      pricingSnippet?: string | null
      costPer1kEst?: number | null
      supportsReasoning?: boolean | null
    }>
    options?: Array<{ value: string; label: string; provider?: string }>
  }
  if (Array.isArray(payload.models) && payload.models.length > 0) {
    return payload.models.map((m) => ({
      value: m.modelId,
      label: resolveCatalogDisplayName(m.modelId, m.displayName),
      provider: providerLabel(m.provider),
      providerKey: m.provider,
      isPinned: Boolean(m.isPinned),
      contextLength: m.contextLength ?? null,
      pricingSnippet: m.pricingSnippet ?? null,
      costPer1kEst: m.costPer1kEst ?? null,
      supportsReasoning: m.supportsReasoning ?? null,
    }))
  }
  return (payload.options ?? []).map((o) => ({
    value: o.value,
    label: resolveCatalogDisplayName(o.value, o.label),
    provider: o.provider ?? providerLabel(o.value.split("/")[0]?.toUpperCase() ?? ""),
    providerKey: (o.value.startsWith("openrouter/") ? "OPENROUTER" : o.value.split("/")[0]?.toUpperCase()) ?? "ANTHROPIC",
    isPinned: false,
    contextLength: null,
    pricingSnippet: null,
    costPer1kEst: null,
    supportsReasoning: null,
  }))
}

async function loadCatalog(): Promise<ModelCatalogOption[]> {
  const res = await fetch(`/api/models/catalog?limit=${MODEL_CATALOG_MAX_LIMIT}`)
  const json: unknown = await res.json()
  return parseCatalog(json)
}

export function useModelCatalog(): { options: ModelCatalogOption[]; loading: boolean } {
  const [options, setOptions] = useState<ModelCatalogOption[]>(cache ?? [])
  const [loading, setLoading] = useState(cache == null)

  useEffect(() => {
    let cancelled = false
    if (!inflight) {
      inflight = loadCatalog().then((rows) => {
        cache = rows
        return rows
      })
    }
    void inflight
      .then((rows) => {
        if (!cancelled) {
          setOptions(rows)
          setLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { options, loading }
}
