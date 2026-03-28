export type TrustTier = "OFFICIAL" | "VERIFIED" | "SCANNED" | "UNREVIEWED"

export type SortOption = "popular" | "newest" | "price_asc" | "price_desc" | "rating"

export interface MarketplaceTemplate {
  id: string
  name: string
  slug: string
  tagline: string
  description: string
  category: string
  price: number
  isFree: boolean
  trustTier: TrustTier
  installCount: number
  avgRating: number | null
  estimatedMonthlyCost: string | null
  creator: {
    id: string
    displayName: string
    avatarUrl: string | null
  } | null
  agents?: Array<{
    name: string
    role: string
    color: string
  }>
  flowDescription?: string
  legalDisclaimer?: string | null
}

export interface MarketplaceSkill {
  id: string
  slug: string
  name: string
  emoji: string | null
  description: string
  category: string
  trustTier: TrustTier
  installCount: number
  avgRating: number | null
  isFree: boolean
  price: number | null
  creator: {
    id: string
    displayName: string
    avatarUrl: string | null
  } | null
}

export interface MarketplaceListResponse<T> {
  items: T[]
  nextCursor: string | null
  totalCount: number
}

export interface MarketplaceFilters {
  category: string
  priceFilter: "" | "free" | "paid"
  sort: SortOption
  search: string
}

export interface TemplateReviewData {
  id: string
  userName: string
  rating: number
  title: string | null
  body: string | null
  verifiedInstall: boolean
  createdAt: string
}

export interface TemplateDetailData {
  template: MarketplaceTemplate & {
    version?: number
    workspaceSnapshot?: string
  }
  reviews: TemplateReviewData[]
  reviewCount: number
  installCount: number
  similar: Array<{
    id: string
    name: string
    slug: string
    tagline: string
    price: number
    category: string
    trustTier: TrustTier
    installCount: number
    avgRating: number | null
  }>
  ownership: {
    owned: boolean
    workspaceId: string | null
    workspaceStatus: string | null
    hasInstall: boolean
  } | null
}

export interface ReportFormData {
  reason: string
  details: string
}

export interface SkillDetailData {
  skill: MarketplaceSkill & {
    skillMd: string
    requiredBins: string[]
    requiredEnvVars: string[]
    minOpenClawVersion: string | null
    publishedAt: string | null
  }
  reviews: TemplateReviewData[]
  reviewCount: number
  installStatus: {
    installed: boolean
    hasRunningWorkspaces: boolean
    workspaces: Array<{ id: string; name: string }>
  } | null
}
