"use client"

import { useState, useEffect, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import Link from "next/link"
import { ArrowLeft, Star, Flag, Wrench } from "lucide-react"
import { PageShell } from "@/components/shared/page-shell"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { AlertBanner } from "@/components/ui/alert-banner"
import { AgentPill } from "@/components/ui/agent-pill"
import { CategoryBadge, type ClawCategory } from "@/components/ui/category-badge"
import { StatusBadge } from "@/components/ui/status-badge"
import { TrustBadge, PriceDisplay, CreatorCard, ReviewCard, ReviewStars } from "@/components/marketplace"
import { mapWorkspaceStatus } from "@/lib/utils"
import type { TemplateReviewData, TrustTier } from "@/types/marketplace"

interface TemplateAgent {
  name: string
  agentSlug?: string
  role: string
  color: string
  model?: string
  roleDescription?: string
}

interface TemplateTool {
  slug: string
  name: string
  category?: string
  connectionType: string
  required: boolean
  alternatives?: string[]
}

interface TemplateData {
  id: string
  name: string
  slug: string
  tagline: string
  description: string
  category: ClawCategory
  price: number
  isFree: boolean
  trustTier: TrustTier
  installCount: number
  avgRating: number | null
  estimatedMonthlyCost: string | null
  agentCount: number
  version?: number
  creatorId: string | null
  creator: {
    id: string
    displayName: string
    avatarUrl: string | null
    bio?: string | null
    totalTemplates?: number
    totalInstalls?: number
    averageRating?: number | null
  } | null
  agents: TemplateAgent[]
  tools: { required: TemplateTool[]; recommended: TemplateTool[] }
  flowDescription: string
  legalDisclaimer?: string | null
}

interface SimilarTemplate {
  id: string
  name: string
  slug: string
  tagline: string
  price: number
  category: string
  trustTier: TrustTier
  installCount: number
  avgRating: number | null
}

interface OwnershipInfo {
  owned: boolean
  workspaceId: string | null
  workspaceStatus: string | null
  hasInstall: boolean
}

interface PageData {
  template: TemplateData
  reviews: TemplateReviewData[]
  reviewCount: number
  installCount: number
  similar: SimilarTemplate[]
  ownership: OwnershipInfo | null
}

export default function TemplateDetailPage() {
  const params = useParams<{ slug: string }>()
  const router = useRouter()
  const { data: session } = useSession()
  const slug = params.slug

  const [data, setData] = useState<PageData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [purchasing, setPurchasing] = useState(false)
  const [purchaseError, setPurchaseError] = useState<string | null>(null)

  const [reviews, setReviews] = useState<TemplateReviewData[]>([])
  const [showAllReviews, setShowAllReviews] = useState(false)
  const [isLoadingReviews, setIsLoadingReviews] = useState(false)

  const [showReviewModal, setShowReviewModal] = useState(false)
  const [reviewRating, setReviewRating] = useState(0)
  const [reviewTitle, setReviewTitle] = useState("")
  const [reviewBody, setReviewBody] = useState("")
  const [isSubmittingReview, setIsSubmittingReview] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)

  const [showReportModal, setShowReportModal] = useState(false)
  const [reportReason, setReportReason] = useState("")
  const [reportDetails, setReportDetails] = useState("")
  const [isSubmittingReport, setIsSubmittingReport] = useState(false)
  const [reportError, setReportError] = useState<string | null>(null)
  const [reportSuccess, setReportSuccess] = useState(false)

  const fetchData = useCallback(() => {
    setIsLoading(true)
    setError(null)
    fetch(`/api/marketplace/templates/${slug}`)
      .then((res) => {
        if (!res.ok) throw new Error(res.status === 404 ? "Template not found" : "Failed to load")
        return res.json()
      })
      .then((json) => {
        const payload = json.data ?? json
        setData(payload)
        setReviews(payload.reviews ?? [])
        setIsLoading(false)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load")
        setIsLoading(false)
      })
  }, [slug])

  useEffect(() => { fetchData() }, [fetchData])

  const loadMoreReviews = useCallback(async () => {
    if (!data || isLoadingReviews || reviews.length === 0) return
    setIsLoadingReviews(true)
    const cursor = reviews[reviews.length - 1].id
    try {
      const res = await fetch(`/api/marketplace/templates/${slug}/reviews?cursor=${cursor}&limit=10`)
      const json = await res.json()
      const payload = json.data ?? json
      setReviews((prev) => [...prev, ...(payload.items ?? [])])
    } catch { /* user can retry */ }
    setIsLoadingReviews(false)
  }, [data, slug, reviews, isLoadingReviews])

  const handlePurchase = async () => {
    if (!session?.user) {
      router.push(`/auth/signin?callbackUrl=/store/${slug}`)
      return
    }
    if (!data) return

    setPurchasing(true)
    setPurchaseError(null)
    try {
      const t = data.template
      let checkoutType = "claw_purchase"
      if (t.isFree) checkoutType = "free_template"
      else if (t.creatorId) checkoutType = "community_purchase"

      const res = await fetch("/api/dodo-payments/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: checkoutType, templateId: t.id }),
      })
      const json = await res.json()
      if (!res.ok || !json.success) {
        setPurchaseError(json.error?.message || "Purchase failed")
        return
      }
      if (json.data?.redirectUrl) { router.push(json.data.redirectUrl); return }
      if (json.data?.checkoutUrl) { window.location.href = json.data.checkoutUrl }
    } catch {
      setPurchaseError("Something went wrong. Please try again.")
    } finally {
      setPurchasing(false)
    }
  }

  const handleSubmitReview = async () => {
    if (reviewRating === 0) { setReviewError("Please select a rating"); return }
    setIsSubmittingReview(true)
    setReviewError(null)
    try {
      const res = await fetch(`/api/marketplace/templates/${slug}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating: reviewRating, title: reviewTitle.trim() || null, body: reviewBody.trim() || null }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error?.message || "Failed to submit review")
      }
      setShowReviewModal(false)
      setReviewRating(0)
      setReviewTitle("")
      setReviewBody("")
      fetchData()
    } catch (err: unknown) {
      setReviewError(err instanceof Error ? err.message : "Failed to submit review")
    }
    setIsSubmittingReview(false)
  }

  const handleSubmitReport = async () => {
    if (!reportReason) { setReportError("Please select a reason"); return }
    setIsSubmittingReport(true)
    setReportError(null)
    try {
      const res = await fetch(`/api/marketplace/templates/${slug}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reportReason, details: reportDetails.trim() || null }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error?.message || "Failed to submit report")
      }
      setReportSuccess(true)
      setTimeout(() => { setShowReportModal(false); setReportSuccess(false); setReportReason(""); setReportDetails("") }, 2000)
    } catch (err: unknown) {
      setReportError(err instanceof Error ? err.message : "Failed to submit report")
    }
    setIsSubmittingReport(false)
  }

  if (isLoading) {
    return (
      <PageShell background="secondary">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="space-y-4">
            <div className="h-3 bg-[var(--bg3)] rounded w-24 animate-pulse" />
            <div className="h-6 bg-[var(--bg3)] rounded w-1/3 animate-pulse" />
            <div className="h-4 bg-[var(--bg3)] rounded w-2/3 animate-pulse" />
            <div className="h-40 bg-[var(--bg3)] rounded animate-pulse" />
            <div className="h-32 bg-[var(--bg3)] rounded animate-pulse" />
          </div>
        </div>
      </PageShell>
    )
  }

  if (error || !data) {
    return (
      <PageShell background="secondary">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <Link href="/store" className="text-[11px] text-[var(--ac)] hover:text-[var(--tx)] mb-4 inline-flex items-center gap-1">
            <ArrowLeft size={12} aria-hidden="true" /> Back to store
          </Link>
          <AlertBanner variant="error">
            <p className="font-medium">{error || "Template not found"}</p>
          </AlertBanner>
        </div>
      </PageShell>
    )
  }

  const { template, reviewCount, installCount, similar, ownership } = data
  const isOfficial = template.trustTier === "OFFICIAL"
  const allTools = [...template.tools.required, ...template.tools.recommended]

  return (
    <PageShell background="secondary">
      <div className="max-w-4xl mx-auto px-4 py-4">
        <Link href="/store" className="text-[11px] text-[var(--ac)] hover:text-[var(--tx)] mb-[10px] inline-flex items-center gap-1">
          <ArrowLeft size={12} aria-hidden="true" /> Back to store
        </Link>

        {/* Header: title + purchase */}
        <div className="flex justify-between items-start mb-4">
          <div className="max-w-[560px]">
            <div className="flex items-center gap-2 mb-1.5">
              <TrustBadge tier={template.trustTier} />
              <CategoryBadge category={template.category} />
            </div>
            <h1 className="text-[22px] font-semibold text-[var(--tx)]">{template.name}</h1>
            <p className="text-[13px] text-[var(--tx2)] mt-1 leading-relaxed">{template.tagline}</p>

            <div className="flex gap-3 mt-2 text-[11px] text-[var(--tx3)]">
              <span>{installCount.toLocaleString()} installs</span>
              {template.avgRating != null && template.avgRating > 0 && (
                <>
                  <span>·</span>
                  <span className="flex items-center gap-[2px]">
                    <Star size={10} fill="#FFDC6E" stroke="#FFDC6E" aria-hidden="true" />
                    {template.avgRating.toFixed(1)}
                  </span>
                </>
              )}
              <span>·</span>
              <span>{reviewCount} {reviewCount === 1 ? "review" : "reviews"}</span>
            </div>
          </div>

          <div className="text-right flex-shrink-0 ml-6">
            {ownership?.owned ? (
              <>
                <div className="flex items-center gap-1.5 justify-end mb-2">
                  <StatusBadge status={mapWorkspaceStatus(ownership.workspaceStatus ?? "DRAFT")} />
                  <span className="text-[12px] font-medium text-[var(--tx)]">You own this</span>
                </div>
                <div className="flex gap-2">
                  {ownership.workspaceStatus === "RUNNING" ? (
                    <>
                      <Button onClick={() => router.push(`/dashboard/${ownership.workspaceId}`)}>Open Dashboard</Button>
                      <Button variant="outline" onClick={() => router.push(`/builder/${ownership.workspaceId}`)}>Open Builder</Button>
                    </>
                  ) : (
                    <>
                      <Button onClick={() => router.push(`/setup/${ownership.workspaceId}/step/1`)}>Deploy</Button>
                      <Button variant="outline" onClick={() => router.push(`/builder/${ownership.workspaceId}`)}>Open Builder</Button>
                    </>
                  )}
                </div>
              </>
            ) : (
              <>
                <PriceDisplay price={template.price} isFree={template.isFree} />
                <Button
                  size="lg"
                  className="mt-2.5"
                  onClick={handlePurchase}
                  loading={purchasing}
                >
                  {!session?.user
                    ? "Sign in to purchase"
                    : template.isFree
                      ? "Install — Free"
                      : `Purchase — $${template.price}`}
                </Button>
                {purchaseError && <p className="text-[10px] text-[var(--err)] mt-1">{purchaseError}</p>}
              </>
            )}
          </div>
        </div>

        {/* Agent pills */}
        <div className="border border-[var(--bd)] rounded-[12px] p-[14px] mb-3.5">
          <h2 className="text-[13px] font-semibold text-[var(--tx)] mb-2">Agents ({template.agentCount})</h2>
          <div className="flex flex-wrap gap-[6px]">
            {template.agents.map((agent) => (
              <AgentPill key={agent.name} name={agent.name} color={agent.color} role={agent.role as "ORCHESTRATOR" | "WORKER" | "CRITIC"} />
            ))}
          </div>
        </div>

        {/* Tools */}
        {allTools.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-3.5">
            <div className="border border-[var(--bd)] rounded-[12px] p-3.5">
              <h2 className="text-[13px] font-semibold mb-2">Required tools</h2>
              <div className="flex flex-col gap-1.5 text-[12px]">
                {template.tools.required.map((tool) => (
                  <div key={tool.slug} className="flex items-center gap-2">
                    <Wrench size={11} className="text-[var(--tx3)]" aria-hidden="true" />
                    <span className="text-[var(--tx)]">{tool.name}</span>
                    <span className="text-[10px] text-[var(--ok)] ml-auto">Required</span>
                  </div>
                ))}
                {template.tools.required.length === 0 && <p className="text-[var(--tx3)]">None</p>}
              </div>
            </div>
            <div className="border border-[var(--bd)] rounded-[12px] p-3.5">
              <h2 className="text-[13px] font-semibold mb-2">Recommended <span className="text-[10px] font-normal text-[var(--tx2)]">(swappable)</span></h2>
              <div className="flex flex-col gap-1.5 text-[12px]">
                {template.tools.recommended.map((tool) => (
                  <div key={tool.slug} className="flex items-center gap-2">
                    <Wrench size={11} className="text-[var(--tx3)]" aria-hidden="true" />
                    <span className="text-[var(--tx)]">{tool.name}</span>
                    {tool.alternatives && tool.alternatives.length > 0 && (
                      <span className="text-[9px] text-[var(--tx3)] ml-auto">or {tool.alternatives.join(", ")}</span>
                    )}
                  </div>
                ))}
                {template.tools.recommended.length === 0 && <p className="text-[var(--tx3)]">None</p>}
              </div>
            </div>
          </div>
        )}

        {/* Estimated costs */}
        <div className="bg-[var(--bg3)] rounded-[12px] p-[14px] mb-3.5">
          <h2 className="text-[13px] font-semibold text-[var(--tx)] mb-2">Estimated Monthly Cost</h2>
          <div className="text-[12px] text-[var(--tx2)] space-y-1">
            <div className="flex justify-between">
              <span>LLM (AI models)</span>
              <span>{template.estimatedMonthlyCost ? `$${template.estimatedMonthlyCost}` : "$40–80"}/mo</span>
            </div>
            <div className="flex justify-between">
              <span>Platform fee</span>
              <span>$79/mo</span>
            </div>
          </div>
          <div className="flex justify-between text-[12px] font-semibold text-[var(--tx)] mt-2 pt-2 border-t border-[var(--bd)]">
            <span>Estimated total</span>
            <span>~${template.estimatedMonthlyCost ? `${Number(template.estimatedMonthlyCost) + 79}` : "120–160"}/mo</span>
          </div>
        </div>

        {/* Creator */}
        <div className="mb-3.5">
          <CreatorCard creator={template.creator} isOfficial={isOfficial} />
        </div>

        {/* Flow description */}
        <div className="text-[11px] text-[var(--tx2)] italic leading-normal py-2 px-3 bg-[var(--bg2)] rounded-[8px] border-l-[3px] border-[var(--bd)] mb-3.5">
          {template.flowDescription}
        </div>

        {/* Description */}
        <div className="mb-3.5">
          <h2 className="text-[13px] font-semibold text-[var(--tx)] mb-2">About this Claw</h2>
          <p className="text-[12px] text-[var(--tx2)] leading-relaxed whitespace-pre-line">{template.description}</p>
        </div>

        {template.legalDisclaimer && (
          <div className="text-[10px] text-[#92400e] bg-[var(--warnbg)] py-1.5 px-3 rounded-[8px] mb-3.5 border-l-[3px] border-[var(--warn)]">
            {template.legalDisclaimer}
          </div>
        )}

        {/* Reviews */}
        <div className="mb-3.5">
          <div className="flex justify-between items-center mb-2">
            <h2 className="text-[13px] font-semibold text-[var(--tx)]">Reviews</h2>
            {reviewCount > 0 && template.avgRating != null && (
              <span className="text-[12px] text-[var(--tx3)] flex items-center gap-1">
                <Star size={10} fill="#FFDC6E" stroke="#FFDC6E" aria-hidden="true" />
                {template.avgRating.toFixed(1)} ({reviewCount})
              </span>
            )}
          </div>

          {reviews.length === 0 ? (
            <p className="text-[12px] text-[var(--tx3)]">No reviews yet. Be the first!</p>
          ) : (
            reviews.slice(0, showAllReviews ? undefined : 5).map((r) => (
              <ReviewCard key={r.id} review={r} />
            ))
          )}

          {reviewCount > 5 && !showAllReviews && (
            <button
              onClick={() => { setShowAllReviews(true); if (reviews.length <= 5) loadMoreReviews() }}
              className="text-[12px] text-[var(--ac)] hover:text-[var(--tx)] cursor-pointer mt-2 bg-transparent border-0 p-0"
            >
              Show all {reviewCount} reviews
            </button>
          )}

          {showAllReviews && isLoadingReviews && (
            <p className="text-[11px] text-[var(--tx3)] mt-2">Loading more reviews...</p>
          )}

          {ownership?.hasInstall && (
            <Button variant="outline" size="sm" className="mt-3" onClick={() => setShowReviewModal(true)}>
              Write a review
            </Button>
          )}
        </div>

        {/* Similar templates */}
        {similar.length > 0 && (
          <div className="mb-3.5">
            <h2 className="text-[13px] font-semibold text-[var(--tx)] mb-2">Similar Templates</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {similar.map((t) => (
                <Link
                  key={t.id}
                  href={`/store/${t.slug}`}
                  className="border border-[var(--bd)] rounded-[12px] p-[10px] hover:border-[var(--bd2)] transition-colors"
                >
                  <div className="text-[12px] font-semibold text-[var(--tx)]">{t.name}</div>
                  <div className="text-[10px] text-[var(--tx2)] mt-[2px] truncate">{t.tagline}</div>
                  <div className="text-[10px] text-[var(--tx3)] mt-1">
                    ${t.price} · {t.installCount} installs
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Report link */}
        <div className="text-center mt-4 mb-2">
          <button
            onClick={() => setShowReportModal(true)}
            className="text-[11px] text-[var(--tx3)] hover:text-[var(--tx)] inline-flex items-center gap-1 bg-transparent border-0 cursor-pointer p-0"
          >
            <Flag size={10} aria-hidden="true" />
            Report this template
          </button>
        </div>
      </div>

      {/* Review Modal */}
      <Modal open={showReviewModal} onClose={() => { setShowReviewModal(false); setReviewError(null) }} title="Write a Review" size="sm">
        <div className="space-y-3">
          {reviewError && <AlertBanner variant="error">{reviewError}</AlertBanner>}
          <div>
            <label className="text-[11px] font-medium text-[var(--tx2)] mb-1 block">Rating</label>
            <ReviewStars value={reviewRating} onChange={setReviewRating} />
          </div>
          <div>
            <label className="text-[11px] font-medium text-[var(--tx2)] mb-1 block">Title <span className="text-[var(--tx3)]">(optional)</span></label>
            <input
              value={reviewTitle}
              onChange={(e) => setReviewTitle(e.target.value)}
              placeholder="Summarize your experience"
              maxLength={200}
              className="w-full px-[10px] py-2 border border-[var(--bd)] rounded-[6px] text-[12px] text-[var(--tx)] bg-[var(--bg)] focus:border-[var(--tx)] focus:outline-none"
            />
          </div>
          <div>
            <label className="text-[11px] font-medium text-[var(--tx2)] mb-1 block">Review <span className="text-[var(--tx3)]">(optional)</span></label>
            <textarea
              value={reviewBody}
              onChange={(e) => setReviewBody(e.target.value)}
              placeholder="Share your experience with this template..."
              maxLength={2000}
              rows={4}
              className="w-full px-[10px] py-2 border border-[var(--bd)] rounded-[6px] text-[12px] text-[var(--tx)] bg-[var(--bg)] resize-none focus:border-[var(--tx)] focus:outline-none"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={() => setShowReviewModal(false)}>Cancel</Button>
          <Button onClick={handleSubmitReview} loading={isSubmittingReview} disabled={reviewRating === 0}>Submit Review</Button>
        </div>
      </Modal>

      {/* Report Modal */}
      <Modal open={showReportModal} onClose={() => { setShowReportModal(false); setReportError(null); setReportSuccess(false) }} title="Report Template" size="sm">
        {reportSuccess ? (
          <div className="text-center py-4">
            <p className="text-[13px] font-semibold text-[var(--ok)]">Report submitted</p>
            <p className="text-[11px] text-[var(--tx2)] mt-1">Thank you for helping keep the marketplace safe.</p>
          </div>
        ) : (
          <>
            {reportError && <AlertBanner variant="error">{reportError}</AlertBanner>}
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-medium text-[var(--tx2)] mb-1 block">Reason</label>
                <select
                  value={reportReason}
                  onChange={(e) => setReportReason(e.target.value)}
                  className="w-full px-[10px] py-2 border border-[var(--bd)] rounded-[6px] text-[12px] text-[var(--tx)] bg-[var(--bg)] focus:border-[var(--tx)] focus:outline-none"
                >
                  <option value="">Select a reason...</option>
                  <option value="MALICIOUS">Malicious content</option>
                  <option value="MISLEADING">Misleading description</option>
                  <option value="COPYRIGHT">Copyright violation</option>
                  <option value="SPAM">Spam</option>
                  <option value="INAPPROPRIATE">Inappropriate content</option>
                  <option value="BROKEN">Broken / doesn&apos;t work</option>
                  <option value="NAME_CONFLICT">Name conflict</option>
                </select>
              </div>
              <div>
                <label className="text-[11px] font-medium text-[var(--tx2)] mb-1 block">Details <span className="text-[var(--tx3)]">(optional)</span></label>
                <textarea
                  value={reportDetails}
                  onChange={(e) => setReportDetails(e.target.value)}
                  placeholder="Provide additional context..."
                  maxLength={2000}
                  rows={3}
                  className="w-full px-[10px] py-2 border border-[var(--bd)] rounded-[6px] text-[12px] text-[var(--tx)] bg-[var(--bg)] resize-none focus:border-[var(--tx)] focus:outline-none"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" onClick={() => setShowReportModal(false)}>Cancel</Button>
              <Button onClick={handleSubmitReport} loading={isSubmittingReport} disabled={!reportReason}>Submit Report</Button>
            </div>
          </>
        )}
      </Modal>
    </PageShell>
  )
}
