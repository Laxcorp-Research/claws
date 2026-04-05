import { prisma } from "@/lib/db"
import { Prisma, type TrustTier, type ClawCategory } from "@/generated/prisma/client"
import { formatMarketplaceTemplateRow } from "@/lib/marketplace/format-marketplace-template"

const TIER_ORDER: TrustTier[] = ["UNREVIEWED", "SCANNED", "VERIFIED", "OFFICIAL"]

/**
 * Build a PostgreSQL full-text search query from user input.
 * AND logic for terms, prefix match per term, non-alphanumeric stripped.
 */
export function buildTsQuery(searchInput: string): string {
  let cleaned = searchInput.replace(/[^\w\s-]/g, "").trim()
  cleaned = cleaned.replace(/-{2,}/g, " ").trim()
  if (!cleaned) return ""
  return cleaned
    .split(/\s+/)
    .map((t) => t.replace(/^-+|-+$/g, ""))
    .filter((t) => t.length > 0 && /[a-zA-Z0-9]/.test(t))
    .map((t) => `${t}:*`)
    .join(" & ")
}

type TemplateListParams = {
  category?: string
  trustTier?: string
  section?: string
  isFree?: boolean
  sort?: string
  cursor?: string
  limit?: number
}

export type MarketplaceSkillListItem = {
  id: string
  slug: string
  name: string
  emoji: string | null
  description: string
  category: string
  trustTier: string
  installCount: number
  avgRating: number | null
  isFree: boolean
  price: number | null
  creator: { id: string; displayName: string; avatarUrl: string | null } | null
}

function trustTierInClause(trustTier: string): TrustTier[] | null {
  const minIndex = TIER_ORDER.indexOf(trustTier as TrustTier)
  if (minIndex < 0) return null
  return TIER_ORDER.slice(minIndex)
}

function templateWhereFromFilters(params: {
  category?: string
  trustTier?: string
  section?: string
  isFree?: boolean
}): Prisma.ClawTemplateWhereInput {
  const { category, trustTier, section, isFree } = params
  const where: Prisma.ClawTemplateWhereInput = { isPublished: true }

  if (category) {
    where.category = category as ClawCategory
  }

  if (section === "official") {
    where.trustTier = "OFFICIAL"
  } else if (section === "new") {
    where.trustTier = { not: "OFFICIAL" }
  } else if (trustTier) {
    const tiers = trustTierInClause(trustTier)
    if (tiers?.length) {
      where.trustTier = { in: tiers }
    }
  }

  if (isFree === true) {
    where.isFree = true
  } else if (isFree === false) {
    where.isFree = false
    where.price = { gt: 0 }
  }

  return where
}

export async function searchTemplates(params: TemplateListParams & { search: string }) {
  const { search, category, trustTier, section, isFree, sort, cursor, limit = 20 } = params
  const tsQuery = buildTsQuery(search)

  if (!tsQuery) {
    return listTemplates({ category, trustTier, section, isFree, sort, cursor, limit })
  }

  const conditions: string[] = [`t."isPublished" = true`, `t."searchVector" @@ to_tsquery('english', $1)`]
  const queryParams: unknown[] = [tsQuery]
  let paramIndex = 2

  if (category) {
    conditions.push(`t."category" = $${paramIndex}`)
    queryParams.push(category)
    paramIndex++
  }

  if (section === "official") {
    conditions.push(`t."trustTier" = 'OFFICIAL'`)
  } else if (section === "new") {
    conditions.push(`t."trustTier" <> 'OFFICIAL'`)
  } else if (trustTier) {
    const tiers = trustTierInClause(trustTier)
    if (tiers?.length) {
      const placeholders = tiers.map((_, i) => `$${paramIndex + i}`).join(", ")
      conditions.push(`t."trustTier" IN (${placeholders})`)
      queryParams.push(...tiers)
      paramIndex += tiers.length
    }
  }

  if (isFree === true) {
    conditions.push(`t."isFree" = true`)
  } else if (isFree === false) {
    conditions.push(`t."isFree" = false AND t."price" > 0`)
  }

  if (cursor) {
    conditions.push(`t."id" < $${paramIndex}`)
    queryParams.push(cursor)
    paramIndex++
  }

  const whereClause = conditions.join(" AND ")

  let orderClause: string
  if (sort === "newest") {
    orderClause = `ts_rank_cd(t."searchVector", to_tsquery('english', $1)) DESC, t."createdAt" DESC`
  } else if (sort === "price_asc") {
    orderClause = `ts_rank_cd(t."searchVector", to_tsquery('english', $1)) DESC, t."price" ASC NULLS FIRST`
  } else if (sort === "price_desc") {
    orderClause = `ts_rank_cd(t."searchVector", to_tsquery('english', $1)) DESC, t."price" DESC NULLS LAST`
  } else if (sort === "rating") {
    orderClause = `ts_rank_cd(t."searchVector", to_tsquery('english', $1)) DESC, t."avgRating" DESC NULLS LAST`
  } else {
    orderClause = `ts_rank_cd(t."searchVector", to_tsquery('english', $1)) DESC, t."installCount" DESC`
  }

  type RawRow = {
    id: string
    slug: string
    name: string
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
    creator_id_inner: string | null
    creator_displayName: string | null
    creator_avatarUrl: string | null
  }

  const selectSql = `
    SELECT
      t."id", t."slug", t."name", t."tagline", t."description", t."category",
      t."price", t."isFree", t."trustTier", t."installCount", t."avgRating",
      t."estimatedMonthlyCost", t."workspaceSnapshot",
      cp."id" AS "creator_id_inner",
      cp."displayName" AS "creator_displayName",
      cp."avatarUrl" AS "creator_avatarUrl"
    FROM "ClawTemplate" t
    LEFT JOIN "CreatorProfile" cp ON cp."id" = t."creatorId"
    WHERE ${whereClause}
    ORDER BY ${orderClause}
    LIMIT ${limit + 1}
  `

  const rows = await prisma.$queryRawUnsafe<RawRow[]>(selectSql, ...queryParams)

  const hasMore = rows.length > limit
  const slice = hasMore ? rows.slice(0, limit) : rows
  const nextCursor = hasMore && slice.length > 0 ? slice[slice.length - 1].id : null

  const items = slice.map((r) =>
    formatMarketplaceTemplateRow({
      id: r.id,
      name: r.name,
      slug: r.slug,
      tagline: r.tagline,
      description: r.description,
      category: r.category,
      price: r.price,
      isFree: r.isFree,
      trustTier: r.trustTier,
      installCount: r.installCount,
      avgRating: r.avgRating,
      estimatedMonthlyCost: r.estimatedMonthlyCost,
      workspaceSnapshot: r.workspaceSnapshot,
      creator: r.creator_id_inner
        ? {
            id: r.creator_id_inner,
            displayName: r.creator_displayName ?? "",
            avatarUrl: r.creator_avatarUrl,
          }
        : null,
    }),
  )

  const totalCount = cursor
    ? -1
    : (
        await prisma.$queryRawUnsafe<Array<{ c: number }>>(
          `SELECT COUNT(*)::int AS c FROM "ClawTemplate" t WHERE ${whereClause}`,
          ...queryParams,
        )
      )[0]?.c ?? 0

  return { items, nextCursor, hasMore, totalCount }
}

async function listTemplates(params: TemplateListParams) {
  const { category, trustTier, section, isFree, sort, cursor, limit = 20 } = params

  const where = templateWhereFromFilters({ category, trustTier, section, isFree })

  const orderBy: Prisma.ClawTemplateOrderByWithRelationInput = (() => {
    switch (sort) {
      case "newest":
        return { createdAt: "desc" }
      case "price_asc":
        return { price: "asc" }
      case "price_desc":
        return { price: "desc" }
      case "rating":
        return { avgRating: "desc" }
      case "popular":
      default:
        return { installCount: "desc" }
    }
  })()

  const templates = await prisma.clawTemplate.findMany({
    where,
    select: {
      id: true,
      name: true,
      slug: true,
      tagline: true,
      description: true,
      category: true,
      price: true,
      isFree: true,
      trustTier: true,
      installCount: true,
      avgRating: true,
      estimatedMonthlyCost: true,
      workspaceSnapshot: true,
      creator: { select: { id: true, displayName: true, avatarUrl: true } },
    },
    orderBy,
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  })

  const hasMore = templates.length > limit
  const slice = hasMore ? templates.slice(0, limit) : templates
  const nextCursor = hasMore && slice.length > 0 ? slice[slice.length - 1].id : null

  const items = slice.map((t) => formatMarketplaceTemplateRow(t))

  const totalCount = cursor
    ? -1
    : await prisma.clawTemplate.count({ where })

  return { items, nextCursor, hasMore, totalCount }
}

function skillWhereFromFilters(params: {
  category?: string
  trustTier?: string
  section?: string
  isFree?: boolean
}): Prisma.MarketplaceSkillWhereInput {
  const { category, trustTier, section, isFree } = params
  const where: Prisma.MarketplaceSkillWhereInput = { isPublished: true }

  if (category) {
    where.category = category
  }

  if (section === "official") {
    where.trustTier = "OFFICIAL"
  } else if (section === "popular") {
    where.trustTier = { not: "OFFICIAL" }
  } else if (trustTier) {
    const tiers = trustTierInClause(trustTier)
    if (tiers?.length) {
      where.trustTier = { in: tiers }
    }
  }

  if (isFree === true) {
    where.isFree = true
  } else if (isFree === false) {
    where.isFree = false
  }

  return where
}

export async function searchSkills(
  params: TemplateListParams & { search: string; sort?: string },
): Promise<{ items: MarketplaceSkillListItem[]; nextCursor: string | null; hasMore: boolean; totalCount: number }> {
  const { search, category, trustTier, section, isFree, sort, cursor, limit = 20 } = params
  const tsQuery = buildTsQuery(search)

  if (!tsQuery) {
    return listSkills({ category, trustTier, section, isFree, sort, cursor, limit })
  }

  const conditions: string[] = [`s."isPublished" = true`, `s."searchVector" @@ to_tsquery('english', $1)`]
  const queryParams: unknown[] = [tsQuery]
  let paramIndex = 2

  if (category) {
    conditions.push(`s."category" = $${paramIndex}`)
    queryParams.push(category)
    paramIndex++
  }

  if (section === "official") {
    conditions.push(`s."trustTier" = 'OFFICIAL'`)
  } else if (section === "popular") {
    conditions.push(`s."trustTier" <> 'OFFICIAL'`)
  } else if (trustTier) {
    const tiers = trustTierInClause(trustTier)
    if (tiers?.length) {
      const placeholders = tiers.map((_, i) => `$${paramIndex + i}`).join(", ")
      conditions.push(`s."trustTier" IN (${placeholders})`)
      queryParams.push(...tiers)
      paramIndex += tiers.length
    }
  }

  if (isFree === true) {
    conditions.push(`s."isFree" = true`)
  } else if (isFree === false) {
    conditions.push(`s."isFree" = false`)
  }

  if (cursor) {
    conditions.push(`s."id" < $${paramIndex}`)
    queryParams.push(cursor)
    paramIndex++
  }

  const whereClause = conditions.join(" AND ")

  let orderClause: string
  if (sort === "newest") {
    orderClause = `ts_rank_cd(s."searchVector", to_tsquery('english', $1)) DESC, s."publishedAt" DESC NULLS LAST`
  } else if (sort === "price_asc") {
    orderClause = `ts_rank_cd(s."searchVector", to_tsquery('english', $1)) DESC, s."price" ASC NULLS FIRST`
  } else if (sort === "price_desc") {
    orderClause = `ts_rank_cd(s."searchVector", to_tsquery('english', $1)) DESC, s."price" DESC NULLS LAST`
  } else if (sort === "rating") {
    orderClause = `ts_rank_cd(s."searchVector", to_tsquery('english', $1)) DESC, s."avgRating" DESC NULLS LAST`
  } else {
    orderClause = `ts_rank_cd(s."searchVector", to_tsquery('english', $1)) DESC, s."installCount" DESC`
  }

  type RawSkill = {
    id: string
    slug: string
    name: string
    emoji: string | null
    description: string
    category: string
    trustTier: string
    installCount: number
    avgRating: number | null
    isFree: boolean
    price: number | null
    creator_id_inner: string | null
    creator_displayName: string | null
    creator_avatarUrl: string | null
  }

  const selectSql = `
    SELECT
      s."id", s."slug", s."name", s."emoji", s."description", s."category",
      s."trustTier", s."installCount", s."avgRating", s."isFree", s."price",
      cp."id" AS "creator_id_inner",
      cp."displayName" AS "creator_displayName",
      cp."avatarUrl" AS "creator_avatarUrl"
    FROM "MarketplaceSkill" s
    LEFT JOIN "CreatorProfile" cp ON cp."id" = s."creatorId"
    WHERE ${whereClause}
    ORDER BY ${orderClause}
    LIMIT ${limit + 1}
  `

  const rows = await prisma.$queryRawUnsafe<RawSkill[]>(selectSql, ...queryParams)

  const hasMore = rows.length > limit
  const slice = hasMore ? rows.slice(0, limit) : rows
  const nextCursor = hasMore && slice.length > 0 ? slice[slice.length - 1].id : null

  const items: MarketplaceSkillListItem[] = slice.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    emoji: r.emoji,
    description: r.description,
    category: r.category,
    trustTier: r.trustTier,
    installCount: r.installCount,
    avgRating: r.avgRating,
    isFree: r.isFree,
    price: r.price,
    creator: r.creator_id_inner
      ? {
          id: r.creator_id_inner,
          displayName: r.creator_displayName ?? "",
          avatarUrl: r.creator_avatarUrl,
        }
      : null,
  }))

  const totalCount = cursor
    ? -1
    : (
        await prisma.$queryRawUnsafe<Array<{ c: number }>>(
          `SELECT COUNT(*)::int AS c FROM "MarketplaceSkill" s WHERE ${whereClause}`,
          ...queryParams,
        )
      )[0]?.c ?? 0

  return { items, nextCursor, hasMore, totalCount }
}

async function listSkills(params: TemplateListParams & { sort?: string }) {
  const { category, trustTier, section, isFree, sort, cursor, limit = 20 } = params

  const where = skillWhereFromFilters({ category, trustTier, section, isFree })

  const orderBy: Prisma.MarketplaceSkillOrderByWithRelationInput = (() => {
    switch (sort) {
      case "newest":
        return { publishedAt: "desc" }
      case "price_asc":
        return { price: "asc" }
      case "price_desc":
        return { price: "desc" }
      case "rating":
        return { avgRating: "desc" }
      case "popular":
      default:
        return { installCount: "desc" }
    }
  })()

  const skills = await prisma.marketplaceSkill.findMany({
    where,
    include: {
      creator: { select: { id: true, displayName: true, avatarUrl: true } },
    },
    orderBy,
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  })

  const hasMore = skills.length > limit
  const slice = hasMore ? skills.slice(0, limit) : skills
  const nextCursor = hasMore && slice.length > 0 ? slice[slice.length - 1].id : null

  const items: MarketplaceSkillListItem[] = slice.map((s) => ({
    id: s.id,
    slug: s.slug,
    name: s.name,
    emoji: s.emoji,
    description: s.description,
    category: s.category,
    trustTier: s.trustTier,
    installCount: s.installCount,
    avgRating: s.avgRating,
    isFree: s.isFree,
    price: s.price,
    creator: s.creator,
  }))

  const totalCount = cursor ? -1 : await prisma.marketplaceSkill.count({ where })

  return { items, nextCursor, hasMore, totalCount }
}
