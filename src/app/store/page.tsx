"use client"

import { Suspense, useState, useMemo, useCallback, useRef } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import { Search, Package } from "lucide-react"
import { PageShell } from "@/components/shared/page-shell"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/empty-state"
import { AlertBanner } from "@/components/ui/alert-banner"
import { ClawCard, type ClawCardData } from "@/components/store/claw-card"
import { MarketplaceTabs } from "@/components/marketplace/marketplace-tabs"
import { MarketplaceFilters } from "@/components/marketplace/marketplace-filters"
import { SkillCard } from "@/components/marketplace/skill-card"
import { TrustBadge } from "@/components/marketplace/trust-badge"
import { useMarketplace } from "@/hooks/use-marketplace"
import type { SortOption, MarketplaceTemplate, MarketplaceSkill, MarketplaceFilters as Filters } from "@/types/marketplace"

function toClawCard(t: MarketplaceTemplate): ClawCardData {
  return {
    name: t.name,
    slug: t.slug,
    price: t.price,
    tagline: t.tagline,
    flowDescription: t.flowDescription ?? "",
    legalDisclaimer: t.legalDisclaimer,
    agents: t.agents ?? [],
  }
}

function SectionHeader({ title, count, badge }: { title: string; count?: number; badge?: React.ReactNode }) {
  return (
    <div className="flex justify-between items-center mb-2 pb-1.5 border-b border-[var(--bd)]">
      <h2 className="text-[14px] font-semibold text-[var(--tx)]">
        {title}{count !== undefined && count > 0 && <span className="text-[var(--tx3)] font-normal"> · {count}</span>}
      </h2>
      {badge}
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
  if (!isLoading && templates.length === 0 && !error && !emptyText) return null

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
          <div className="space-y-2">
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
          {nextCursor && (
            <div className="text-center mt-4">
              <Button variant="outline" onClick={loadMore} loading={isLoadingMore}>
                Load more
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  )
}

function TemplateSkeleton() {
  return (
    <div className="space-y-2">
      {[1, 2, 3].map((i) => (
        <div key={i} className="border border-[var(--bd)] rounded-[12px] p-3.5">
          <div className="h-4 bg-[var(--bg3)] rounded w-1/3 mb-2 animate-pulse" />
          <div className="h-3 bg-[var(--bg3)] rounded w-2/3 mb-2 animate-pulse" />
          <div className="flex gap-2">
            <div className="h-5 bg-[var(--bg3)] rounded w-16 animate-pulse" />
            <div className="h-5 bg-[var(--bg3)] rounded w-16 animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  )
}

function SkillSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {[1, 2, 3, 4].map((i) => (
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

  const popularSkills = useMarketplace<MarketplaceSkill>(
    filters,
    { type: "skills", initialLimit: 20, enabled: isSkillsTab }
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
        {/* Hero — compact */}
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

        {/* Total count */}
        {!isSearchActive && (
          <p className="text-[11px] text-[var(--tx3)] -mt-2 mb-1">
            {isTemplatesTab
              ? `${totalTemplateCount > 0 ? totalTemplateCount.toLocaleString() : "—"} templates`
              : `${totalSkillCount > 0 ? totalSkillCount.toLocaleString() : "—"} skills`}
          </p>
        )}

        <MarketplaceFilters
          mode={activeTab}
          activeCategory={activeCategory}
          priceFilter={priceFilter}
          sort={sort}
          onCategoryChange={(category) => updateParams({ category })}
          onPriceFilterChange={(price) => updateParams({ price })}
          onSortChange={(s) => updateParams({ sort: s })}
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
                    <div className="space-y-2">
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
                      <div className="text-center mt-4">
                        <Button variant="outline" onClick={templateSearch.loadMore} loading={templateSearch.isLoadingMore}>
                          Load more
                        </Button>
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
                    description="Check back soon — new agent teams are being added."
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
                {popularSkills.isLoading ? (
                  <SkillSkeleton />
                ) : popularSkills.error ? (
                  <AlertBanner variant="error">{popularSkills.error}</AlertBanner>
                ) : popularSkills.items.length === 0 ? (
                  <EmptyState
                    icon={<Search className="w-10 h-10" />}
                    title={`No skills match "${searchQuery}"`}
                    description="Try different keywords, or browse all categories."
                    actions={<Button variant="outline" onClick={handleClearSearch}>Clear search</Button>}
                  />
                ) : (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {popularSkills.items.map((skill) => (
                        <SkillCard key={skill.id} skill={skill} />
                      ))}
                    </div>
                    {popularSkills.nextCursor && (
                      <div className="text-center mt-4">
                        <Button variant="outline" onClick={popularSkills.loadMore} loading={popularSkills.isLoadingMore}>
                          Load more
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </section>
            ) : (
              <>
                {/* Official skills — collapsed by default */}
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
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {displayedOfficialSkills.map((skill) => (
                          <SkillCard key={skill.id} skill={skill} />
                        ))}
                      </div>
                      {!showAllOfficial && officialSkills.items.length > INITIAL_OFFICIAL_SKILLS && (
                        <button
                          className="text-[12px] text-[var(--ac)] mt-2 hover:underline cursor-pointer bg-transparent border-0 p-0"
                          onClick={() => setShowAllOfficial(true)}
                        >
                          Show all {officialSkills.items.length} official skills
                        </button>
                      )}
                    </>
                  )}
                </section>

                {/* Popular skills — main section with load more */}
                {(popularSkills.isLoading || popularSkills.items.length > 0) && (
                  <section className="mb-6">
                    <SectionHeader title="Popular" count={popularSkills.totalCount} />
                    {popularSkills.isLoading ? (
                      <SkillSkeleton />
                    ) : (
                      <>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {popularSkills.items.map((skill) => (
                            <SkillCard key={skill.id} skill={skill} />
                          ))}
                        </div>
                        {popularSkills.nextCursor && (
                          <div className="text-center mt-4">
                            <Button variant="outline" onClick={popularSkills.loadMore} loading={popularSkills.isLoadingMore}>
                              Load more skills
                            </Button>
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
