/**
 * Live Anthropic catalog refresh via GET /v1/models (platform master key).
 * OpenAI/Google list endpoints exist but the platform has no keys — pins stay
 * the curated source until/unless platform keys exist.
 */

import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { PINNED_SEED_MODELS } from "@/lib/models/seed-models"
import { resolveCatalogDisplayName } from "@/lib/models/humanize"

export const ANTHROPIC_MODELS_URL = "https://api.anthropic.com/v1/models"
export const ANTHROPIC_VERSION = "2023-06-01"

export type AnthropicModelInfo = {
  id: string
  display_name: string
  created_at?: string
  max_input_tokens?: number | null
}

export type AnthropicFlagshipPins = {
  haiku: AnthropicModelInfo | null
  sonnet: AnthropicModelInfo | null
  opus: AnthropicModelInfo | null
}

type FetchLike = (
  input: string,
  init?: { headers?: Record<string, string> },
) => Promise<{
  ok: boolean
  status: number
  json: () => Promise<unknown>
}>

function familyMatch(model: AnthropicModelInfo, family: "haiku" | "sonnet" | "opus"): boolean {
  const id = model.id.toLowerCase()
  const name = (model.display_name ?? "").toLowerCase()
  return id.includes(family) || name.includes(family)
}

function isDatedSnapshot(id: string): boolean {
  return /-\d{8}$/.test(id)
}

/** Newest-first list; prefer alias over dated snapshot within each family. */
export function pickAnthropicFlagshipPins(models: AnthropicModelInfo[]): AnthropicFlagshipPins {
  const pick = (family: "haiku" | "sonnet" | "opus"): AnthropicModelInfo | null => {
    const matches = models.filter((m) => familyMatch(m, family))
    if (matches.length === 0) return null
    return matches.find((m) => !isDatedSnapshot(m.id)) ?? matches[0] ?? null
  }
  return { haiku: pick("haiku"), sonnet: pick("sonnet"), opus: pick("opus") }
}

export function anthropicCatalogModelId(id: string): string {
  return id.startsWith("anthropic/") ? id : `anthropic/${id}`
}

/**
 * Extended thinking shipped with Claude 3.7; every later family (4.x, 5)
 * supports it. The /v1/models payload has no capability flags, so this is a
 * version heuristic over both id shapes:
 *   old  claude-3-7-sonnet-20250219  (version before family)
 *   new  claude-sonnet-4-6 / claude-opus-5  (family before version)
 * Unparseable ids return null (unknown), never false.
 */
export function anthropicSupportsReasoning(id: string): boolean | null {
  const match = id.toLowerCase().match(/claude-(?:[a-z]+-)?(\d+)(?:[.-](\d+))?/)
  if (!match) return null
  const major = Number(match[1])
  const minor = Number(match[2] ?? 0)
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return null
  return major > 3 || (major === 3 && minor >= 7)
}

export async function fetchAnthropicModels(fetcher: FetchLike = fetch): Promise<AnthropicModelInfo[]> {
  const key = process.env.CLAWS_MASTER_ANTHROPIC_KEY
  if (!key || key.startsWith("placeholder-")) {
    throw new Error("ANTHROPIC_REFRESH_SKIPPED_NO_KEY")
  }

  const out: AnthropicModelInfo[] = []
  let afterId: string | null = null
  for (let page = 0; page < 20; page++) {
    const url = new URL(ANTHROPIC_MODELS_URL)
    url.searchParams.set("limit", "100")
    if (afterId) url.searchParams.set("after_id", afterId)
    const res = await fetcher(url.toString(), {
      headers: {
        "x-api-key": key,
        "anthropic-version": ANTHROPIC_VERSION,
      },
    })
    if (!res.ok) {
      throw new Error(`Anthropic /v1/models failed: ${res.status}`)
    }
    const json = (await res.json()) as {
      data?: AnthropicModelInfo[]
      has_more?: boolean
      last_id?: string | null
    }
    const data = json.data ?? []
    out.push(...data)
    if (!json.has_more) break
    afterId = json.last_id ?? null
    if (!afterId) break
  }
  return out
}

function seedCost(modelId: string): number | null {
  return PINNED_SEED_MODELS.find((s) => s.modelId === modelId)?.costPer1kEst ?? null
}

export async function refreshAnthropicCatalog(
  fetcher: FetchLike = fetch,
): Promise<{ upserted: number; fetched: number; pinned: string[] }> {
  const models = await fetchAnthropicModels(fetcher)
  const flagship = pickAnthropicFlagshipPins(models)
  const pinIds = [flagship.haiku, flagship.sonnet, flagship.opus]
    .filter((m): m is AnthropicModelInfo => m !== null)
    .map((m) => anthropicCatalogModelId(m.id))
  const pinSet = new Set(pinIds)
  const now = new Date()
  const liveIds = models.map((m) => anthropicCatalogModelId(m.id))

  const CHUNK = 50
  let upserted = 0
  for (let i = 0; i < models.length; i += CHUNK) {
    const chunk = models.slice(i, i + CHUNK)
    await prisma.$transaction(
      chunk.map((m) => {
        const modelId = anthropicCatalogModelId(m.id)
        const cost = seedCost(modelId)
        const contextLength =
          typeof m.max_input_tokens === "number" && m.max_input_tokens > 0
            ? m.max_input_tokens
            : null
        const supportsReasoning = anthropicSupportsReasoning(m.id)
        return prisma.modelCatalogEntry.upsert({
          where: { modelId },
          create: {
            modelId,
            provider: "ANTHROPIC",
            displayName: resolveCatalogDisplayName(modelId, m.display_name),
            contextLength,
            pricingSnippet: null,
            costPer1kEst: cost,
            supportsReasoning,
            isPinned: pinSet.has(modelId),
            isActive: true,
            source: "anthropic",
            rawMeta: m as object,
            refreshedAt: now,
          },
          update: {
            displayName: resolveCatalogDisplayName(modelId, m.display_name),
            contextLength,
            supportsReasoning,
            isPinned: pinSet.has(modelId),
            isActive: true,
            source: "anthropic",
            rawMeta: m as object,
            refreshedAt: now,
            ...(cost != null ? { costPer1kEst: cost } : {}),
          },
        })
      }),
    )
    upserted += chunk.length
  }

  if (liveIds.length > 0) {
    await prisma.modelCatalogEntry.updateMany({
      where: {
        provider: "ANTHROPIC",
        modelId: { notIn: liveIds },
      },
      data: { isActive: false, isPinned: false },
    })
  }

  log.info("Anthropic model catalog refreshed", {
    category: "models",
    fetched: models.length,
    upserted,
    pinned: pinIds,
  })
  return { upserted, fetched: models.length, pinned: pinIds }
}
