import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { PINNED_SEED_MODELS } from "@/lib/models/seed-models"
import { refreshAnthropicCatalog } from "@/lib/models/anthropic-catalog"
import { resolveCatalogDisplayName, stripVendorPrefix } from "@/lib/models/humanize"
import { providerLabel } from "@/lib/models/provider-labels"
import { MODEL_CATALOG_MAX_LIMIT } from "@/lib/models/catalog-limits"

export { providerLabel, MODEL_CATALOG_MAX_LIMIT }

export type CatalogModel = {
  modelId: string
  provider: string
  displayName: string
  contextLength: number | null
  pricingSnippet: string | null
  costPer1kEst: number | null
  /** true/false from provider metadata; null = unknown (control stays enabled). */
  supportsReasoning: boolean | null
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
        supportsReasoning: seed.supportsReasoning ?? null,
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
        supportsReasoning: seed.supportsReasoning ?? null,
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
  supported_parameters?: string[]
}

/**
 * OpenRouter's /models lists each model's accepted request params;
 * "reasoning"/"include_reasoning" mark adjustable-effort models.
 * Missing list = unknown (null), NOT false: the UI must not lock the
 * thinking control on stale metadata.
 */
export function reasoningFromOpenRouter(m: OpenRouterModel): boolean | null {
  if (!Array.isArray(m.supported_parameters)) return null
  return m.supported_parameters.some(
    (p) => p === "reasoning" || p === "include_reasoning",
  )
}

/**
 * Native OPENAI/GOOGLE catalogs are derived from OpenRouter's public list:
 * OpenRouter ids are exactly our native refs (`openai/gpt-4o`, `google/gemini-2.5-pro`),
 * so a BYOK key can call every derived row directly. The platform holds no
 * OpenAI/Google keys, so this public list is the only live source.
 * Variant suffixes (`:free`, `:extended`) are OpenRouter-only routes — skipped.
 * Anthropic is NOT derived here: its native list comes from the live
 * Anthropic /v1/models refresh, which is authoritative.
 */
export function derivedNativeFromOpenRouter(
  m: OpenRouterModel,
): { modelId: string; provider: "OPENAI" | "GOOGLE" } | null {
  if (m.id.includes(":")) return null
  if (m.id.startsWith("openai/")) return { modelId: m.id, provider: "OPENAI" }
  if (m.id.startsWith("google/")) return { modelId: m.id, provider: "GOOGLE" }
  return null
}

/**
 * Refresh OpenRouter catalog from public GET /models (no key required).
 * Writes openrouter/<id> refs plus derived native OPENAI/GOOGLE rows.
 * Does not deactivate pinned seeds.
 */
export async function refreshOpenRouterCatalog(): Promise<{
  upserted: number
  fetched: number
  derivedNatives: number
}> {
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
  let derivedNatives = 0

  // Batch in chunks to avoid huge transactions
  const CHUNK = 50
  for (let i = 0; i < models.length; i += CHUNK) {
    const chunk = models.slice(i, i + CHUNK)
    const writes = chunk.flatMap((m) => {
      const modelId = `openrouter/${m.id}`
      const pinned = PINNED_SEED_MODELS.some((s) => s.modelId === modelId)
      const supportsReasoning = reasoningFromOpenRouter(m)
      const ops = [
        prisma.modelCatalogEntry.upsert({
          where: { modelId },
          create: {
            modelId,
            provider: "OPENROUTER",
            displayName: resolveCatalogDisplayName(modelId, m.name),
            contextLength: m.context_length ?? null,
            pricingSnippet: pricingSnippetFromOpenRouter(m.pricing),
            costPer1kEst: costPer1kFromOpenRouter(m.pricing),
            supportsReasoning,
            isPinned: pinned,
            isActive: true,
            source: "openrouter",
            rawMeta: m as object,
            refreshedAt: now,
          },
          update: {
            displayName: resolveCatalogDisplayName(modelId, m.name),
            contextLength: m.context_length ?? null,
            pricingSnippet: pricingSnippetFromOpenRouter(m.pricing),
            costPer1kEst: costPer1kFromOpenRouter(m.pricing),
            supportsReasoning,
            isActive: true,
            source: "openrouter",
            rawMeta: m as object,
            refreshedAt: now,
            // Keep existing isPinned if already pinned via seed
            ...(pinned ? { isPinned: true } : {}),
          },
        }),
      ]

      const native = derivedNativeFromOpenRouter(m)
      if (native) {
        derivedNatives += 1
        const nativePinned = PINNED_SEED_MODELS.some((s) => s.modelId === native.modelId)
        const nativeName = resolveCatalogDisplayName(native.modelId, stripVendorPrefix(m.name))
        ops.push(
          prisma.modelCatalogEntry.upsert({
            where: { modelId: native.modelId },
            create: {
              modelId: native.modelId,
              provider: native.provider,
              displayName: nativeName,
              contextLength: m.context_length ?? null,
              pricingSnippet: pricingSnippetFromOpenRouter(m.pricing),
              costPer1kEst: costPer1kFromOpenRouter(m.pricing),
              supportsReasoning,
              isPinned: nativePinned,
              isActive: true,
              source: "openrouter-derived",
              rawMeta: m as object,
              refreshedAt: now,
            },
            update: {
              displayName: nativeName,
              contextLength: m.context_length ?? null,
              pricingSnippet: pricingSnippetFromOpenRouter(m.pricing),
              costPer1kEst: costPer1kFromOpenRouter(m.pricing),
              supportsReasoning,
              isActive: true,
              source: "openrouter-derived",
              rawMeta: m as object,
              refreshedAt: now,
              ...(nativePinned ? { isPinned: true } : {}),
            },
          }),
        )
      }
      return ops
    })
    await prisma.$transaction(writes)
    upserted += chunk.length
  }

  log.info("OpenRouter model catalog refreshed", {
    category: "models",
    fetched: models.length,
    upserted,
    derivedNatives,
  })
  return { upserted, fetched: models.length, derivedNatives }
}

/**
 * Native refresh: Anthropic has a live GET /v1/models (platform master key).
 * OpenAI GET /v1/models and Google GET /v1beta/models exist but the platform
 * holds no keys — pins remain the curated source until/if platform keys exist.
 * MUTATION: drop the Anthropic /v1/models call → anthropic-catalog tests fail.
 */
export async function refreshNativeProviderLists(): Promise<{
  seed: number
  anthropic: { upserted: number; fetched: number; pinned: string[] } | { skipped: true }
}> {
  const seed = await ensureSeedModels()
  try {
    const anthropic = await refreshAnthropicCatalog()
    return { seed, anthropic }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg === "ANTHROPIC_REFRESH_SKIPPED_NO_KEY") {
      log.warn("Anthropic catalog refresh skipped: no CLAWS_MASTER_ANTHROPIC_KEY", {
        category: "models",
      })
      return { seed, anthropic: { skipped: true } }
    }
    throw err
  }
}

export async function refreshAllModelCatalogs(): Promise<{
  seed: number
  anthropic: { upserted: number; fetched: number; pinned: string[] } | { skipped: true }
  openrouter: { upserted: number; fetched: number; derivedNatives: number }
}> {
  const native = await refreshNativeProviderLists()
  const openrouter = await refreshOpenRouterCatalog()
  return { seed: native.seed, anthropic: native.anthropic, openrouter }
}

function withResolvedNames(rows: CatalogModel[]): CatalogModel[] {
  return rows.map((row) => ({
    ...row,
    displayName: resolveCatalogDisplayName(row.modelId, row.displayName),
  }))
}

export async function queryModelCatalog(params: {
  q?: string
  provider?: string
  pinnedOnly?: boolean
  limit?: number
  /** Ignored — enablement is UI-only so locked providers stay visible. */
  creditMode?: boolean
}): Promise<CatalogModel[]> {
  const limit = Math.min(Math.max(params.limit ?? 40, 1), MODEL_CATALOG_MAX_LIMIT)
  const where: {
    isActive: boolean
    isPinned?: boolean
    provider?: string | { in: string[] }
    OR?: Array<{ displayName: { contains: string; mode: "insensitive" } } | { modelId: { contains: string; mode: "insensitive" } }>
  } = { isActive: true }

  if (params.pinnedOnly) where.isPinned = true
  if (params.provider) {
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
      supportsReasoning: true,
      isPinned: true,
    },
  })

  // If DB empty (pre-migrate / first boot), fall back to seeds in-memory.
  if (rows.length === 0) {
    return withResolvedNames(
      PINNED_SEED_MODELS.filter((s) => {
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
        supportsReasoning: s.supportsReasoning ?? null,
        isPinned: s.isPinned,
      })),
    )
  }

  return withResolvedNames(rows)
}

export function catalogToLegacyOptions(models: CatalogModel[]): LegacyModelRow[] {
  return models.map((m) => ({
    value: m.modelId,
    label: m.displayName,
    provider: providerLabel(m.provider),
    tier: m.isPinned ? "recommended" : "catalog",
    costPer1kCalls: m.costPer1kEst ?? 0,
  }))
}
