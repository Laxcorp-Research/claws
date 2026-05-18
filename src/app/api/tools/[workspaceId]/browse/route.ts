import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, ERRORS } from "@/lib/api/response"
import { ALL_TOOLS, TOOL_CATEGORIES, type ToolDefinition } from "@/data/tool-catalog"
import { getComposioCatalogTools } from "@/lib/composio-catalog"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { workspaceId } = await params

  const { error } = await verifyWorkspaceOwnership(workspaceId, user.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("Workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()

  const composioOAuthAvailable = Boolean(process.env.COMPOSIO_API_KEY?.trim())

  let composioTools: ToolDefinition[] = []
  try {
    composioTools = await getComposioCatalogTools()
  } catch {
    composioTools = []
  }

  const staticSlugs = new Set(ALL_TOOLS.map((t) => t.slug))
  // PR2.8a-fix1 Task 7: comingSoon entries are reserved catalog slugs whose
  // integration isn't deployable today. Hiding them from Browse keeps users
  // from clicking Connect on a row that would 422 (RED toolkits) or have no
  // runtime path (PR2.8c placeholders). Static catalog already flags these;
  // live Composio toolkits never set comingSoon (filter is a no-op on them).
  const merged: ToolDefinition[] = [
    ...ALL_TOOLS,
    ...composioTools.filter((t) => !staticSlugs.has(t.slug)),
  ].filter((t) => !t.comingSoon)

  const categorySet = new Set<string>([...TOOL_CATEGORIES])
  for (const t of merged) {
    if (t.category) categorySet.add(t.category)
  }
  const categories = Array.from(categorySet).sort((a, b) => {
    if (a === "All") return -1
    if (b === "All") return 1
    return a.localeCompare(b)
  })

  return apiSuccess({
    tools: merged,
    categories,
    total: merged.length,
    composioOAuthAvailable,
  })
}
