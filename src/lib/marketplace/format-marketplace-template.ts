export interface SnapshotAgent {
  name: string
  role: string
  color: string
}

export function formatMarketplaceTemplateRow(t: {
  id: string
  name: string
  slug: string
  tagline: string
  description: string
  category: string
  price: number
  isFree: boolean
  trustTier: string
  installCount: number
  avgRating: number | null
  estimatedMonthlyCost: string | null
  workspaceSnapshot: string
  creator: { id: string; displayName: string; avatarUrl: string | null } | null
}) {
  let agents: SnapshotAgent[] = []
  let flowDescription = ""
  let legalDisclaimer: string | null = null
  try {
    const snap = JSON.parse(t.workspaceSnapshot) as {
      agents?: SnapshotAgent[]
      flowDescription?: string
      legalDisclaimer?: string | null
    }
    agents = (snap.agents ?? []).map((a) => ({
      name: a.name,
      role: a.role,
      color: a.color,
    }))
    flowDescription = snap.flowDescription ?? ""
    legalDisclaimer = snap.legalDisclaimer ?? null
  } catch {
    /* malformed snapshot */
  }

  return {
    id: t.id,
    name: t.name,
    slug: t.slug,
    tagline: t.tagline,
    description: t.description,
    category: t.category,
    price: t.price,
    isFree: t.isFree,
    trustTier: t.trustTier,
    installCount: t.installCount,
    avgRating: t.avgRating,
    estimatedMonthlyCost: t.estimatedMonthlyCost,
    creator: t.creator,
    agents,
    flowDescription,
    legalDisclaimer,
  }
}
