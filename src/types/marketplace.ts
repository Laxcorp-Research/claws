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
