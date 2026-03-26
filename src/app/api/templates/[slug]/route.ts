import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { apiSuccess, ERRORS } from "@/lib/api/response"

interface SnapshotAgent {
  name: string
  agentSlug: string
  role: string
  color: string
  model: string
  roleDescription: string
}

interface SnapshotTool {
  slug: string
  name: string
  category: string
  connectionType: string
  required: boolean
  alternatives?: string[]
}

interface SnapshotConnection {
  sourceSlug: string
  targetSlug: string
  condition: string
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params

  const template = await prisma.clawTemplate.findUnique({ where: { slug } })
  if (!template) return ERRORS.NOT_FOUND("template")

  let agents: SnapshotAgent[] = []
  let tools: { required: SnapshotTool[]; recommended: SnapshotTool[] } = { required: [], recommended: [] }
  let connections: SnapshotConnection[] = []
  let flowDescription = ""
  let legalDisclaimer: string | null = null

  try {
    const snap = JSON.parse(template.workspaceSnapshot)
    agents = (snap.agents ?? []).map((a: SnapshotAgent) => ({
      name: a.name, agentSlug: a.agentSlug, role: a.role, color: a.color, model: a.model, roleDescription: a.roleDescription,
    }))
    const allTools = (snap.tools ?? []) as SnapshotTool[]
    tools = { required: allTools.filter((t) => t.required), recommended: allTools.filter((t) => !t.required) }
    connections = snap.connections ?? []
    flowDescription = snap.flowDescription ?? ""
    legalDisclaimer = snap.legalDisclaimer ?? null
  } catch { /* malformed snapshot */ }

  return apiSuccess({
    id: template.id,
    name: template.name,
    slug: template.slug,
    tagline: template.tagline,
    description: template.description,
    category: template.category,
    price: template.price,
    agentCount: template.agentCount,
    featured: template.featured,
    agents,
    tools,
    connections,
    flowDescription,
    legalDisclaimer,
    isFree: template.isFree,
    creatorId: template.creatorId,
    installCount: template.installCount,
    purchaseCount: template.purchaseCount,
    avgRating: template.avgRating,
  })
}
