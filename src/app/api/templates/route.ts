import { prisma } from "@/lib/db"
import { apiSuccess } from "@/lib/api/response"

interface SnapshotAgent {
  name: string
  role: string
  color: string
}

export async function GET() {
  const templates = await prisma.clawTemplate.findMany({
    where: { isPublished: true },
    orderBy: { sortOrder: "asc" },
  })

  const data = templates.map((t) => {
    let agents: SnapshotAgent[] = []
    let flowDescription = ""
    let legalDisclaimer: string | null = null
    try {
      const snap = JSON.parse(t.workspaceSnapshot)
      agents = (snap.agents ?? []).map((a: SnapshotAgent) => ({ name: a.name, role: a.role, color: a.color }))
      flowDescription = snap.flowDescription ?? ""
      legalDisclaimer = snap.legalDisclaimer ?? null
    } catch { /* malformed snapshot */ }

    return {
      id: t.id,
      name: t.name,
      slug: t.slug,
      tagline: t.tagline,
      description: t.description,
      category: t.category,
      price: t.price,
      agentCount: t.agentCount,
      featured: t.featured,
      agents,
      flowDescription,
      legalDisclaimer,
      purchaseCount: t.purchaseCount,
      avgRating: t.avgRating,
    }
  })

  return apiSuccess({ templates: data })
}
