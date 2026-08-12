import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { PINNED_SEED_MODELS } from "@/lib/models/seed-models"

export type CatalogModel = {
  modelId: string
  provider: string
  displayName: string
  contextLength: number | null
  pricingSnippet: string | null
  costPer1kEst: number | null
  isPinned: boolean
}

/** Legacy UI shape used by getModelLabel / getModelCost / AI_MODELS fallbacks. */
export type LegacyModelRow = {
  value: string
  label: string
  provider: string
  tier: string
  costPer1kCalls: number
}

const PROVIDER_LABEL: Record<string, string> = {
  ANTHROPIC: "Anthropic",
  OPENAI: "OpenAI",
  GOOGLE: "Google",
  OPENROUTER: "OpenRouter",
}

function pricingSnippetFromOpenRouter(pricing: {
  prompt?: string
  completion?: string
} | null | undefined): string | null {
  if (!pricing?.prompt && !pricing?.completion) return null
  const p = Number(pricing.prompt ?? 0)
  const c = Number(pricing.completion ?? 0)
  // OpenRouter quotes USD per token; show per 1M for readability.
  const p1m = p * 1_000_000
  const c1m = c * 1_000_000
  if (!Number.isFinite(p1m) || !Number.isFinite(c1m)) return "OpenRouter est."
  if (p1m === 0 && c1m === 0) return "Free / promo"
  return `$${p1m.toFixed(2)}/$${c1m.toFixed(2)} per 1M tok`
}

function costPer1kFromOpenRouter(pricing: {
  prompt?: string
  completion?: string
} | null | undefined): number | null {
  if (!pricing) return null
  const p = Number(pricing.prompt ?? 0)
  const c = Number(pricing.completion ?? 0)
  if (!Number.isFinite(p) || !Number.isFinite(c)) return null
  // Rough: 750 prompt + 250 completion tokens ≈ 1 "call"
  return Math.round((p * 750 + c * 250) * 1000 * 10000) / 10000
}

export async function ensureSeedModels(): Promise<number> {
  let upserted = 0
  for (const seed of PINNED_SEED_MODELS) {
    await prisma.modelCatalogEntry.upsert({
      where: { modelId: seed.modelId },
      create: {
        modelId: seed.modelId,
        provider: seed.provider,
        displayName: seed.displayName,
        contextLength: seed.contextLength ?? null,
        pricingSnippet: seed.pricingSnippet ?? null,
        costPer1kEst: seed.costPer1kEst ?? null,
        isPinned: seed.isPinned,
        isActive: true,
        source: "seed",
        refreshedAt: new Date(),
      },
      update: {
        displayName: seed.displayName,
        contextLength: seed.contextLength ?? null,
        pricingSnippet: seed.pricingSnippet ?? null,
        costPer1kEst: seed.costPer1kEst ?? null,
        isPinned: seed.isPinned,
        isActive: true,
        refreshedAt: new Date(),
      },
    })
    upserted += 1
  }
  return upserted
}

type OpenRouterModel = {
  id: string
  name?: string
  context_length?: number
  pricing?: { prompt?: string; completion?: string }
}

/**
 * Refresh OpenRouter catalog from public GET /models (no key required).
 * Writes openrouter/<id> refs. Does not deactivate pinned seeds.
 */
export async function refreshOpenRouterCatalog(): Promise<{ upserted: number; fetched: number }> {
  const res = await fetch("https://openrouter.ai/api/v1/models", {
    headers: { Accept: "application/json" },
  })
  if (!res.ok) {
    throw new Error(`OpenRouter /models failed: ${res.status}`)
  }
  const json = (await res.json()) as { data?: OpenRouterModel[] }
  const models = json.data ?? []
  const now = new Date()
  let upserted = 0

  // Batch in chunks to avoid huge transactions
  const CHUNK = 50
  for (let i = 0; i < models.length; i += CHUNK) {
    const chunk = models.slice(i, i + CHUNK)
    await prisma.$transaction(
      chunk.map((m) => {
        const modelId = `openrouter/${m.id}`
        const pinned = PINNED_SEED_MODELS.some((s) => s.modelId === modelId)
        return prisma.modelCatalogEntry.upsert({
          where: { modelId },
          create: {
            modelId,
            provider: "OPENROUTER",
            displayName: m.name || m.id,
            contextLength: m.context_length ?? null,
            pricingSnippet: pricingSnippetFromOpenRouter(m.pricing),
            costPer1kEst: costPer1kFromOpenRouter(m.pricing),
            isPinned: pinned,
            isActive: true,
            source: "openrouter",
            rawMeta: m as object,
            refreshedAt: now,
          },
          update: {
            displayName: m.name || m.id,
            contextLength: m.context_length ?? null,
            pricingSnippet: pricingSnippetFromOpenRouter(m.pricing),
            costPer1kEst: costPer1kFromOpenRouter(m.pricing),
            isActive: true,
            source: "openrouter",
            rawMeta: m as object,
            refreshedAt: now,
            // Keep existing isPinned if already pinned via seed
            ...(pinned ? { isPinned: true } : {}),
          },
        })
      }),
    )
    upserted += chunk.length
  }

  log.info("OpenRouter model catalog refreshed", {
    category: "models",
    fetched: models.length,
    upserted,
  })
  return { upserted, fetched: models.length }
}

/** Sync native Anthropic/OpenAI/Google lists from seed (API lists are incomplete/auth-gated). */
export async function refreshNativeProviderLists(): Promise<number> {
  return ensureSeedModels()
}

export async function refreshAllModelCatalogs(): Promise<{
  seed: number
  openrouter: { upserted: number; fetched: number }
}> {
  const seed = await ensureSeedModels()
  const openrouter = await refreshOpenRouterCatalog()
  return { seed, openrouter }
}

export async function queryModelCatalog(params: {
  q?: string
  provider?: string
  pinnedOnly?: boolean
  limit?: number
  creditMode?: boolean
}): Promise<CatalogModel[]> {
  const limit = Math.min(Math.max(params.limit ?? 40, 1), 100)
  const where: {
    isActive: boolean
    isPinned?: boolean
    provider?: string | { in: string[] }
    OR?: Array<{ displayName: { contains: string; mode: "insensitive" } } | { modelId: { contains: string; mode: "insensitive" } }>
  } = { isActive: true }

  if (params.pinnedOnly) where.isPinned = true
  if (params.creditMode) {
    where.provider = "ANTHROPIC"
  } else if (params.provider) {
    where.provider = params.provider
  }
  if (params.q?.trim()) {
    const q = params.q.trim()
    where.OR = [
      { displayName: { contains: q, mode: "insensitive" } },
      { modelId: { contains: q, mode: "insensitive" } },
    ]
  }

  const rows = await prisma.modelCatalogEntry.findMany({
    where,
    orderBy: [{ isPinned: "desc" }, { provider: "asc" }, { displayName: "asc" }],
    take: limit,
    select: {
      modelId: true,
      provider: true,
      displayName: true,
      contextLength: true,
      pricingSnippet: true,
      costPer1kEst: true,
      isPinned: true,
    },
  })

  // If DB empty (pre-migrate / first boot), fall back to seeds in-memory.
  if (rows.length === 0) {
    return PINNED_SEED_MODELS.filter((s) => {
      if (params.creditMode && s.provider !== "ANTHROPIC") return false
      if (params.provider && s.provider !== params.provider) return false
      if (params.q) {
        const q = params.q.toLowerCase()
        return s.displayName.toLowerCase().includes(q) || s.modelId.toLowerCase().includes(q)
      }
      return true
    }).map((s) => ({
      modelId: s.modelId,
      provider: s.provider,
      displayName: s.displayName,
      contextLength: s.contextLength ?? null,
      pricingSnippet: s.pricingSnippet ?? null,
      costPer1kEst: s.costPer1kEst ?? null,
      isPinned: s.isPinned,
    }))
  }

  return rows
}

export function catalogToLegacyOptions(models: CatalogModel[]): LegacyModelRow[] {
  return models.map((m) => ({
    value: m.modelId,
    label: m.displayName,
    provider: PROVIDER_LABEL[m.provider] ?? m.provider,
    tier: m.isPinned ? "recommended" : "catalog",
    costPer1kCalls: m.costPer1kEst ?? 0.015,
  }))
}

export function providerLabel(provider: string): string {
  return PROVIDER_LABEL[provider] ?? provider
}
