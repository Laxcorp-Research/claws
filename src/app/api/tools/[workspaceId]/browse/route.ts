import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, ERRORS } from "@/lib/api/response"
import { ALL_TOOLS, TOOL_CATEGORIES, type ToolDefinition } from "@/data/tool-catalog"
import { getComposioCatalogTools } from "@/lib/composio-catalog"

const BROWSE_CACHE_TTL_MS = 5 * 60 * 1000
let browseCache: { payload: { tools: ToolDefinition[]; categories: string[]; total: number }; expiresAt: number } | null = null

export function __resetBrowseToolsCacheForTests() {
  if (process.env.NODE_ENV === "test") browseCache = null
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { workspaceId } = await params

  const { error } = await verifyWorkspaceOwnership(workspaceId, user.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("Workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()

  const composioOAuthAvailable = Boolean(process.env.COMPOSIO_API_KEY?.trim())
  if (browseCache && browseCache.expiresAt > Date.now()) {
    return apiSuccess({
      ...browseCache.payload,
      composioOAuthAvailable,
    })
  }

  let composioTools: ToolDefinition[] = []
  try {
    composioTools = await getComposioCatalogTools()
  } catch {
    composioTools = []
  }

  // Prefer curated ALL_TOOLS rows. Dedup by slug AND composioToolkitId so
  // alias pairs (google_calendar↔googlecalendar, convertkit↔kit) don't
  // surface twice when the live catalog uses the broker slug.
  const claimedIds = new Set<string>()
  for (const t of ALL_TOOLS) {
    claimedIds.add(t.slug)
    if (t.composioToolkitId) claimedIds.add(t.composioToolkitId)
  }
  const merged: ToolDefinition[] = [
    ...ALL_TOOLS,
    ...composioTools.filter((t) => {
      if (claimedIds.has(t.slug)) return false
      if (t.composioToolkitId && claimedIds.has(t.composioToolkitId)) return false
      return true
    }),
  ]

  const categorySet = new Set<string>([...TOOL_CATEGORIES])
  for (const t of merged) {
    if (t.category) categorySet.add(t.category)
  }
  const categories = Array.from(categorySet).sort((a, b) => {
    if (a === "All") return -1
    if (b === "All") return 1
    return a.localeCompare(b)
  })

  const payload = {
    tools: merged,
    categories,
    total: merged.length,
  }
  browseCache = { payload, expiresAt: Date.now() + BROWSE_CACHE_TTL_MS }

  return apiSuccess({
    ...payload,
    composioOAuthAvailable,
  })
}
