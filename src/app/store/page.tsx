"use client"

import { Suspense, useState, useMemo, useCallback, useRef } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { Search, Package } from "lucide-react"
import { PageShell } from "@/components/shared/page-shell"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { AlertBanner } from "@/components/ui/alert-banner"
import { ClawCard, type ClawCardData } from "@/components/store/claw-card"
import { CategoryTiles, TEMPLATE_CATEGORIES, SKILL_CATEGORIES } from "@/components/store/category-tiles"
import { MarketplaceTabs } from "@/components/marketplace/marketplace-tabs"
import { MarketplaceFilters } from "@/components/marketplace/marketplace-filters"
import { SkillCard } from "@/components/marketplace/skill-card"
import { TrustBadge, TrustBadgeLegend } from "@/components/marketplace/trust-badge"
import { useMarketplace } from "@/hooks/use-marketplace"
import type { SortOption, MarketplaceTemplate, MarketplaceSkill, MarketplaceFilters as Filters } from "@/types/marketplace"

function toClawCard(t: MarketplaceTemplate): ClawCardData {
  return {
    name: t.name,
    slug: t.slug,
    price: t.price,
    isFree: t.isFree,
    tagline: t.tagline,
    category: t.category,
    flowDescription: t.flowDescription ?? "",
    legalDisclaimer: t.legalDisclaimer,
    agents: t.agents ?? [],
  }
}

function SectionHeader({ title, count, badge }: { title: string; count?: number; badge?: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center mb-3 pb-1.5 border-b border-[var(--bd)]">
      <h2 className="text-[14px] font-semibold text-[var(--tx)]">
        {title}{count !== undefined && count > 0 && <span className="text-[var(--tx3)] font-normal"> · {count}</span>}
      </h2>
      {badge}
    </div>
  )
}

// Shared "reveal more" control (Load more / Show all) so every disclosure link
// behaves identically: neutral grey text that darkens + underlines on hover.
function MoreButton({ onClick, loading, children }: { onClick: () => void; loading?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      aria-busy={loading || undefined}
      className="inline-flex items-center gap-1.5 text-[12px] text-[var(--tx2)] hover:text-[var(--tx)] hover:underline cursor-pointer bg-transparent border-0 p-0 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:no-underline"
    >
      {loading && (
        <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin flex-shrink-0" aria-hidden="true" />
      )}
      {children}
    </button>
  )
}

const TEMPLATE_LIST = "space-y-2"
const TEMPLATE_INITIAL_VISIBLE = 4
const SKILL_GRID = "grid grid-cols-1 sm:grid-cols-2 gap-2"

function TemplateList({
  templates,
  defaultCreatorName,
}: {
  templates: MarketplaceTemplate[]
  defaultCreatorName?: string
}) {
  return (
    <div className={TEMPLATE_LIST}>
      {templates.map((t) => (
        <ClawCard
          key={t.id}
          claw={toClawCard(t)}
          trustTier={t.trustTier}
          installCount={t.installCount}
          avgRating={t.avgRating}
          creatorName={defaultCreatorName ?? t.creator?.displayName ?? null}
          creatorId={t.creator?.id ?? null}
        />
      ))}
    </div>
  )
}

function TemplateSection({
  title,
  badge,
  templates,
  isLoading,
  error,
  emptyText,
  nextCursor,
  loadMore,
  isLoadingMore,
  defaultCreatorName,
}: {
  title: string
  badge?: React.ReactNode
  templates: MarketplaceTemplate[]
  isLoading: boolean
  error: string | null
  emptyText?: string
  nextCursor: string | null
  loadMore: () => void
  isLoadingMore: boolean
  defaultCreatorName?: string
}) {
  const [visibleCount, setVisibleCount] = useState(TEMPLATE_INITIAL_VISIBLE)

  if (!isLoading && templates.length === 0 && !error && !emptyText) return null

  const visible = templates.slice(0, visibleCount)
  const hasMoreLoaded = visibleCount < templates.length
  const canShowMore = hasMoreLoaded || !!nextCursor

  // Reveal the next batch of already-loaded claws; only hit the server once the
  // loaded set is exhausted but more pages exist.
  const handleShowMore = () => {
    if (hasMoreLoaded) {
      setVisibleCount((count) => count + TEMPLATE_INITIAL_VISIBLE)
    } else if (nextCursor) {
      loadMore()
      setVisibleCount((count) => count + TEMPLATE_INITIAL_VISIBLE)
    }
  }

  return (
    <section className="mb-6">
      <SectionHeader title={title} count={templates.length} badge={badge} />
      {isLoading ? (
        <TemplateSkeleton />
      ) : error ? (
        <AlertBanner variant="error">{error}</AlertBanner>
      ) : templates.length === 0 ? (
        <p className="text-[12px] text-[var(--tx3)]">{emptyText ?? "No templates found."}</p>
      ) : (
        <>
          <TemplateList templates={visible} defaultCreatorName={defaultCreatorName} />
          {canShowMore && (
            <div className="mt-2">
              <MoreButton onClick={handleShowMore} loading={!hasMoreLoaded && isLoadingMore}>
                Show more
              </MoreButton>
            </div>
          )}
        </>
      )}
    </section>
  )
}

function TemplateSkeleton() {
  return (
    <div className={TEMPLATE_LIST}>
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="border border-[var(--bd)] rounded-[12px] px-4 py-3">
          <div className="flex justify-between mb-2">
            <div className="h-4 bg-[var(--bg3)] rounded w-1/2 animate-pulse" />
            <div className="h-4 bg-[var(--bg3)] rounded w-10 animate-pulse" />
          </div>
          <div className="h-3 bg-[var(--bg3)] rounded w-3/4 mb-2 animate-pulse" />
          <div className="h-3 bg-[var(--bg3)] rounded w-1/3 mb-2.5 animate-pulse" />
          <div className="flex gap-1.5">
            <div className="h-5 bg-[var(--bg3)] rounded-full w-16 animate-pulse" />
            <div className="h-5 bg-[var(--bg3)] rounded-full w-16 animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  )
}

function SkillSkeleton() {
  return (
    <div className={SKILL_GRID}>
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div key={i} className="border border-[var(--bd)] rounded-[12px] p-3">
          <div className="h-4 bg-[var(--bg3)] rounded w-1/2 mb-2 animate-pulse" />
          <div className="h-3 bg-[var(--bg3)] rounded w-full animate-pulse" />
        </div>
      ))}
    </div>
  )
}

const INITIAL_OFFICIAL_SKILLS = 6

function StoreContent() {
  const searchParams = useSearchParams()
  const router = useRouter()

  const activeTab = (searchParams.get("tab") || "templates") as "templates" | "skills"
  const activeCategory = searchParams.get("category") || ""
  const priceFilter = (searchParams.get("price") || "") as "" | "free" | "paid"
  const sort = (searchParams.get("sort") || "popular") as SortOption
  const searchQuery = searchParams.get("search") || ""

  const [searchInput, setSearchInput] = useState(searchQuery)
  const [showAllOfficial, setShowAllOfficial] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  const updateParams = useCallback(
    (updates: Record<string, string>) => {
      const params = new URLSearchParams(searchParams.toString())
      for (const [key, value] of Object.entries(updates)) {
        if (value) {
          params.set(key, value)
        } else {
          params.delete(key)
        }
      }
      params.delete("cursor")
      router.push(`/store?${params.toString()}`, { scroll: false })
    },
    [searchParams, router]
  )

  const filters: Filters = useMemo(
    () => ({ category: activeCategory, priceFilter, sort, search: searchQuery }),
    [activeCategory, priceFilter, sort, searchQuery]
  )

  const filtersNoSearch: Filters = useMemo(
    () => ({ ...filters, search: "" }),
    [filters]
  )

  const isSearchActive = searchQuery.length > 0
  const isTemplatesTab = activeTab === "templates"
  const isSkillsTab = activeTab === "skills"

  const official = useMarketplace<MarketplaceTemplate>(
    filtersNoSearch,
    { type: "templates", section: "official", initialLimit: 50, enabled: isTemplatesTab && !isSearchActive }
  )

  const trending = useMarketplace<MarketplaceTemplate>(
    filtersNoSearch,
    { type: "templates", section: "trending", initialLimit: 10, enabled: isTemplatesTab && !isSearchActive }
  )

  const newTemplates = useMarketplace<MarketplaceTemplate>(
    { ...filtersNoSearch, sort: "newest" },
    { type: "templates", section: "new", initialLimit: 10, enabled: isTemplatesTab && !isSearchActive }
  )

  const templateSearch = useMarketplace<MarketplaceTemplate>(
    filters,
    { type: "templates", initialLimit: 20, enabled: isTemplatesTab && isSearchActive }
  )

  const officialSkills = useMarketplace<MarketplaceSkill>(
    filtersNoSearch,
    { type: "skills", section: "official", initialLimit: 50, enabled: isSkillsTab && !isSearchActive }
  )

  // Browse: popular excludes Official. Search: no section so Official is included (Batch A / A1).
  const popularSkills = useMarketplace<MarketplaceSkill>(
    filtersNoSearch,
    { type: "skills", section: "popular", initialLimit: 20, enabled: isSkillsTab && !isSearchActive }
  )

  const skillSearch = useMarketplace<MarketplaceSkill>(
    filters,
    { type: "skills", initialLimit: 20, enabled: isSkillsTab && isSearchActive }
  )

  const handleTabChange = (tab: "templates" | "skills") => {
    updateParams({ tab, category: "", price: "", sort: "popular", search: "" })
    setSearchInput("")
    setShowAllOfficial(false)
  }

  const handleSearchChange = (value: string) => {
    setSearchInput(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      updateParams({ search: value })
    }, 300)
  }

  const handleClearSearch = () => {
    setSearchInput("")
    updateParams({ search: "" })
  }

  const totalTemplateCount = official.totalCount + trending.totalCount + newTemplates.totalCount
  const totalSkillCount = officialSkills.totalCount + popularSkills.totalCount

  const displayedOfficialSkills = showAllOfficial
    ? officialSkills.items
    : officialSkills.items.slice(0, INITIAL_OFFICIAL_SKILLS)

  return (
    <PageShell background="secondary">
      <div className="max-w-5xl mx-auto px-4 py-4">
        {/* Hero - compact */}
        <div className="text-center pt-3 pb-2">
          <h1 className="text-xl font-semibold text-[var(--tx)]">AI agents that work while you sleep</h1>
          <p className="text-[13px] text-[var(--tx2)] mt-1 max-w-lg mx-auto">
            Build, customize, and deploy multi-agent AI teams. Browse official and community templates.
          </p>
          <div className="mt-2 max-w-[280px] mx-auto">
            <input
              type="text"
              placeholder="Search templates and skills..."
              aria-label="Search marketplace"
              value={searchInput}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="px-3.5 py-2 border border-[var(--bd)] rounded-[8px] bg-[var(--bg)] text-[12px] w-full placeholder:text-[var(--tx3)] focus:outline-none focus:border-[var(--tx)] transition-colors"
            />
          </div>
        </div>

        <MarketplaceTabs active={activeTab} onTabChange={handleTabChange} />
        <TrustBadgeLegend className="mt-2 mb-3" />

        {/* Total count - always rendered to prevent layout shift */}
        {!isSearchActive && (
          <p className="text-[11px] text-[var(--tx3)] -mt-2 mb-1 h-[16px]">
            {(isTemplatesTab ? official.isLoading : officialSkills.isLoading) ? (
              <span className="inline-block w-[80px] h-[12px] bg-[var(--bg3)] rounded animate-pulse" />
            ) : (
              isTemplatesTab
                ? `${totalTemplateCount.toLocaleString()} templates`
                : `${totalSkillCount.toLocaleString()} skills`
            )}
          </p>
        )}

        {!isSearchActive && (
          <div className="mb-4">
            <h2 className="text-[13px] font-semibold text-[var(--tx)] mb-2.5">Browse by category</h2>
            <CategoryTiles
              categories={isTemplatesTab ? TEMPLATE_CATEGORIES : SKILL_CATEGORIES}
              size={isTemplatesTab ? "default" : "compact"}
              activeCategory={activeCategory}
              onSelect={(category) => updateParams({ category })}
            />
          </div>
        )}

        <MarketplaceFilters
          mode={activeTab}
          activeCategory={activeCategory}
          priceFilter={priceFilter}
          sort={sort}
          onCategoryChange={(category) => updateParams({ category })}
          onPriceFilterChange={(price) => updateParams({ price })}
          onSortChange={(s) => updateParams({ sort: s })}
          hideCategories
        />

        {isTemplatesTab && (
          <div id="tabpanel-templates" role="tabpanel">
            {isSearchActive ? (
              <section>
                {templateSearch.isLoading ? (
                  <TemplateSkeleton />
                ) : templateSearch.error ? (
                  <AlertBanner variant="error">{templateSearch.error}</AlertBanner>
                ) : templateSearch.items.length === 0 ? (
                  <EmptyState
                    icon={<Search className="w-10 h-10" />}
                    title={`No results for "${searchQuery}"`}
                    description="Try different keywords, or browse all categories."
                    actions={<Button variant="outline" onClick={handleClearSearch}>Clear search</Button>}
                  />
                ) : (
                  <>
                    <div className={TEMPLATE_LIST}>
                      {templateSearch.items.map((t) => (
                        <ClawCard
                          key={t.id}
                          claw={toClawCard(t)}
                          trustTier={t.trustTier}
                          installCount={t.installCount}
                          avgRating={t.avgRating}
                          creatorName={t.trustTier === "OFFICIAL" ? "Claws Team" : t.creator?.displayName ?? null}
                          creatorId={t.creator?.id ?? null}
                        />
                      ))}
                    </div>
                    {templateSearch.nextCursor && (
                      <div className="text-center mt-5">
                        <MoreButton onClick={templateSearch.loadMore} loading={templateSearch.isLoadingMore}>
                          Load more
                        </MoreButton>
                      </div>
                    )}
                  </>
                )}
              </section>
            ) : (
              <>
                <TemplateSection
                  title="Official"
                  badge={<TrustBadge tier="OFFICIAL" />}
                  templates={official.items}
                  isLoading={official.isLoading}
                  error={official.error}
                  emptyText="No official templates in this category."
                  nextCursor={official.nextCursor}
                  loadMore={official.loadMore}
                  isLoadingMore={official.isLoadingMore}
                  defaultCreatorName="Claws Team"
                />

                {(trending.isLoading || trending.items.length > 0) && (
                  <TemplateSection
                    title="Trending"
                    templates={trending.items}
                    isLoading={trending.isLoading}
                    error={trending.error}
                    nextCursor={trending.nextCursor}
                    loadMore={trending.loadMore}
                    isLoadingMore={trending.isLoadingMore}
                  />
                )}

                {(newTemplates.isLoading || newTemplates.items.length > 0) && (
                  <TemplateSection
                    title="New"
                    templates={newTemplates.items}
                    isLoading={newTemplates.isLoading}
                    error={newTemplates.error}
                    nextCursor={newTemplates.nextCursor}
                    loadMore={newTemplates.loadMore}
                    isLoadingMore={newTemplates.isLoadingMore}
                  />
                )}

                {!official.isLoading && !trending.isLoading && !newTemplates.isLoading && official.items.length === 0 && trending.items.length === 0 && newTemplates.items.length === 0 && (
                  <EmptyState
                    icon={<Package className="w-10 h-10" />}
                    title="No templates available"
                    description="Check back soon - new agent teams are being added."
                  />
                )}
              </>
            )}
          </div>
        )}

        {isSkillsTab && (
          <div id="tabpanel-skills" role="tabpanel">
            {isSearchActive ? (
              <section>
                {skillSearch.isLoading ? (
                  <SkillSkeleton />
                ) : skillSearch.error ? (
                  <AlertBanner variant="error">{skillSearch.error}</AlertBanner>
                ) : skillSearch.items.length === 0 ? (
                  <EmptyState
                    icon={<Search className="w-10 h-10" />}
                    title={`No skills match "${searchQuery}"`}
                    description="Try different keywords, or browse all categories."
                    actions={<Button variant="outline" onClick={handleClearSearch}>Clear search</Button>}
                  />
                ) : (
                  <>
                    <div className={SKILL_GRID}>
                      {skillSearch.items.map((skill) => (
                        <SkillCard key={skill.id} skill={skill} />
                      ))}
                    </div>
                    {skillSearch.nextCursor && (
                      <div className="text-center mt-4">
                        <MoreButton onClick={skillSearch.loadMore} loading={skillSearch.isLoadingMore}>
                          Load more
                        </MoreButton>
                      </div>
                    )}
                  </>
                )}
              </section>
            ) : (
              <>
                {/* Official skills - collapsed by default */}
                <section className="mb-6">
                  <SectionHeader title="Official" count={officialSkills.totalCount} badge={<TrustBadge tier="OFFICIAL" />} />
                  {officialSkills.isLoading ? (
                    <SkillSkeleton />
                  ) : officialSkills.error ? (
                    <AlertBanner variant="error">{officialSkills.error}</AlertBanner>
                  ) : officialSkills.items.length === 0 ? (
                    <p className="text-[12px] text-[var(--tx3)]">No official skills in this category.</p>
                  ) : (
                    <>
                      <div className={SKILL_GRID}>
                        {displayedOfficialSkills.map((skill) => (
                          <SkillCard key={skill.id} skill={skill} hideTrustBadge />
                        ))}
                      </div>
                      {!showAllOfficial && officialSkills.items.length > INITIAL_OFFICIAL_SKILLS && (
                        <div className="mt-2">
                          <MoreButton onClick={() => setShowAllOfficial(true)}>
                            Show all {officialSkills.items.length} official skills
                          </MoreButton>
                        </div>
                      )}
                    </>
                  )}
                </section>

                {/* Popular skills - main section with load more */}
                {(popularSkills.isLoading || popularSkills.items.length > 0) && (
                  <section className="mb-6">
                    <SectionHeader title="Popular" count={popularSkills.totalCount} />
                    {popularSkills.isLoading ? (
                      <SkillSkeleton />
                    ) : (
                      <>
                        <div className={SKILL_GRID}>
                          {popularSkills.items.map((skill) => (
                            <SkillCard key={skill.id} skill={skill} />
                          ))}
                        </div>
                        {popularSkills.nextCursor && (
                          <div className="text-center mt-4">
                            <MoreButton onClick={popularSkills.loadMore} loading={popularSkills.isLoadingMore}>
                              Load more skills
                            </MoreButton>
                          </div>
                        )}
                      </>
                    )}
                  </section>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </PageShell>
  )
}

export default function StorePage() {
  return (
    <Suspense fallback={
      <PageShell background="secondary">
        <div className="max-w-5xl mx-auto px-4 py-4">
          <div className="text-center pt-3 pb-2">
            <div className="h-6 bg-[var(--bg3)] rounded w-64 mx-auto mb-2" />
            <div className="h-4 bg-[var(--bg3)] rounded w-96 mx-auto" />
          </div>
          <TemplateSkeleton />
        </div>
      </PageShell>
    }>
      <StoreContent />
    </Suspense>
  )
}
