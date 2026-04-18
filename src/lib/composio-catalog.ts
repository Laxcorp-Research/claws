import type { ToolkitListResponse } from "@composio/client/resources/toolkits"
import { getComposio } from "@/lib/composio"
import type { ToolDefinition } from "@/data/tool-catalog"
import { redis } from "@/lib/redis"

const REDIS_KEY = "composio:toolkit-catalog:v1"
const CACHE_TTL_SEC = 60 * 60

export interface ComposioCatalogFetchResult {
  tools: ToolDefinition[]
  fetchedAt: number
}

function mapAuthToConnectionType(schemes: string[] | undefined): ToolDefinition["connectionType"] {
  if (!schemes?.length) return "OAUTH_COMPOSIO"
  const s = schemes.map((x) => x.toUpperCase())
  if (s.some((x) => x === "API_KEY" || x === "BEARER_TOKEN")) {
    return "API_KEY"
  }
  return "OAUTH_COMPOSIO"
}

function toolkitItemToToolDefinition(item: ToolkitListResponse.Item): ToolDefinition {
  const cat = item.meta?.categories?.[0]
  const category =
    cat?.name?.toUpperCase().replace(/\s+/g, "_") || cat?.id?.toUpperCase().replace(/\s+/g, "_") || "OTHER"

  return {
    slug: item.slug,
    name: item.name,
    description: item.meta?.description,
    category,
    connectionType: mapAuthToConnectionType(item.auth_schemes),
    composioToolkitId: item.slug,
    isAIProvider: false,
    // Dynamic Composio catalog entries are always OAUTH-managed; their
    // credentials are held by Composio, not by us. Static catalog entries
    // in src/data/tool-catalog.ts declare their own credentialFields.
    credentialFields: [],
  }
}

/**
 * Fetch all toolkits from Composio (paginated). Server-only.
 */
async function fetchAllToolkitItems(composio: NonNullable<ReturnType<typeof getComposio>>) {
  const client = composio.getClient()
  const items: ToolkitListResponse.Item[] = []

  let cursor: string | undefined
  const maxPages = 30
  for (let page = 0; page < maxPages; page++) {
    const res = await client.toolkits.list({
      limit: 100,
      ...(cursor ? { cursor } : {}),
    })
    for (const it of res.items) {
      if (!it.no_auth) {
        items.push(it)
      }
    }
    cursor = res.next_cursor ?? undefined
    if (!cursor) break
  }

  return items
}

async function readRedisCache(): Promise<ComposioCatalogFetchResult | null> {
  try {
    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
      return null
    }
    const raw = await redis.get(REDIS_KEY)
    if (typeof raw !== "string" || !raw) return null
    const parsed = JSON.parse(raw) as ComposioCatalogFetchResult
    if (!parsed?.tools || !Array.isArray(parsed.tools)) return null
    return parsed
  } catch {
    return null
  }
}

async function writeRedisCache(payload: ComposioCatalogFetchResult): Promise<void> {
  try {
    if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) {
      return
    }
    await redis.set(REDIS_KEY, JSON.stringify(payload), { ex: CACHE_TTL_SEC })
  } catch {
    // ignore cache write failures
  }
}

/**
 * Live Composio toolkit catalog merged into ToolDefinition shape, cached ~1h in Redis.
 */
export async function getComposioCatalogTools(): Promise<ToolDefinition[]> {
  const composio = getComposio()
  if (!composio) {
    return []
  }

  const cached = await readRedisCache()
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_SEC * 1000) {
    return cached.tools
  }

  try {
    const rows = await fetchAllToolkitItems(composio)
    const tools = rows.map(toolkitItemToToolDefinition)
    const payload: ComposioCatalogFetchResult = { tools, fetchedAt: Date.now() }
    await writeRedisCache(payload)
    return tools
  } catch {
    if (cached?.tools?.length) {
      return cached.tools
    }
    return []
  }
}
