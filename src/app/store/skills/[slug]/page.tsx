"use client"

import { useState, useEffect, useCallback } from "react"
import { useParams } from "next/navigation"
import { Star, Terminal, Key, Info, Check } from "lucide-react"
import { PageShell } from "@/components/shared/page-shell"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { AlertBanner } from "@/components/ui/alert-banner"
import { TrustBadge, PriceDisplay, CreatorCard, ReviewCard, ReviewStars, PendingReviewEmptyState } from "@/components/marketplace"
import type { TemplateReviewData, TrustTier } from "@/types/marketplace"
import { CustomSelect } from "@/components/ui/custom-select"
import { TextLink } from "@/components/ui/text-link"
import { useSnackbarOptional } from "@/components/shared/snackbar"
import { mutateWithFeedback } from "@/lib/ui/mutate-with-feedback"

interface SkillData {
  id: string
  slug: string
  name: string
  emoji: string | null
  description: string
  category: string
  trustTier: TrustTier
  isFree: boolean
  price: number | null
  installCount: number
  avgRating: number | null
  skillMd: string
  requiredBins: string[]
  requiredEnvVars: string[]
  minOpenClawVersion: string | null
  creator: {
    id: string
    displayName: string
    avatarUrl: string | null
    bio?: string | null
    totalTemplates?: number
    totalInstalls?: number
    averageRating?: number | null
  } | null
  publishedAt: string | null
}

interface PageData {
  skill: SkillData
  reviews: TemplateReviewData[]
  reviewCount: number
  installStatus: {
    installed: boolean
    hasPurchased: boolean
    hasRunningWorkspaces: boolean
    workspaces: Array<{
      id: string
      name: string
      agents: Array<{ id: string; name: string; role: string }>
    }>
  } | null
  isOwner: boolean
}

export default function SkillDetailPage() {
  const params = useParams<{ slug: string }>()
  const slug = params.slug
  const snackbar = useSnackbarOptional()
  const showSnackbar = useCallback(
    (options: Parameters<NonNullable<typeof snackbar>["show"]>[0]) => {
      snackbar?.show(options)
    },
    [snackbar],
  )

  const [data, setData] = useState<PageData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pendingReview, setPendingReview] = useState(false)

  const [reviews, setReviews] = useState<TemplateReviewData[]>([])
  const [showAllReviews, setShowAllReviews] = useState(false)
  const [isLoadingReviews, setIsLoadingReviews] = useState(false)

  const [showInstallModal, setShowInstallModal] = useState(false)
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("")
  const [selectedAgentId, setSelectedAgentId] = useState("")
  const [isInstalling, setIsInstalling] = useState(false)
  const [isPurchasing, setIsPurchasing] = useState(false)
  const [installError, setInstallError] = useState<string | null>(null)
  const [installSuccess, setInstallSuccess] = useState(false)

  const [showReviewModal, setShowReviewModal] = useState(false)
  const [reviewRating, setReviewRating] = useState(0)
  const [reviewTitle, setReviewTitle] = useState("")
  const [reviewBody, setReviewBody] = useState("")
  const [isSubmittingReview, setIsSubmittingReview] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)

  const fetchData = useCallback(() => {
    setIsLoading(true)
    setError(null)
    setPendingReview(false)
    fetch(`/api/marketplace/skills/${slug}`)
      .then((res) => {
        if (!res.ok) throw new Error(res.status === 404 ? "Skill not found" : "Failed to load")
        return res.json()
      })
      .then((json) => {
        const payload = json.data ?? json
        if (payload?.listingState === "pending_review") {
          setPendingReview(true)
          setIsLoading(false)
          return
        }
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
      const res = await fetch(`/api/marketplace/skills/${slug}/reviews?cursor=${cursor}&limit=10`)
      const json = await res.json()
      const payload = json.data ?? json
      setReviews((prev) => [...prev, ...(payload.items ?? [])])
    } catch { /* user can retry */ }
    setIsLoadingReviews(false)
  }, [data, slug, reviews, isLoadingReviews])

  const workspaceAgents =
    data?.installStatus?.workspaces.find((w) => w.id === selectedWorkspaceId)?.agents ?? []

  const defaultAgentId = (() => {
    const orch = workspaceAgents.find((a) => a.role === "ORCHESTRATOR")
    return orch?.id ?? workspaceAgents[0]?.id ?? ""
  })()

  const handlePurchase = async () => {
    if (!data) return
    setIsPurchasing(true)
    setInstallError(null)
    try {
      await mutateWithFeedback(
        async () => {
          const res = await fetch("/api/dodo-payments/checkout", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ type: "community_purchase", skillId: data.skill.id }),
          })
          const json = await res.json()
          if (!res.ok) {
            throw new Error(json.error?.message || "Purchase failed")
          }
          if (json.data?.checkoutUrl) {
            window.location.href = json.data.checkoutUrl as string
            return
          }
          fetchData()
        },
        {
          message: "Purchase complete — you can install now",
          errorMessage: "Could not start purchase",
        },
        showSnackbar,
      )
    } catch (err: unknown) {
      setInstallError(err instanceof Error ? err.message : "Purchase failed")
    } finally {
      setIsPurchasing(false)
    }
  }

  const handleInstall = async () => {
    if (!selectedWorkspaceId) { setInstallError("Please select a workspace"); return }
    const agentId = selectedAgentId || defaultAgentId
    if (!agentId) { setInstallError("Please select an agent"); return }
    setIsInstalling(true)
    setInstallError(null)
    try {
      await mutateWithFeedback(
        async () => {
          const res = await fetch(`/api/marketplace/skills/${slug}/install`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              workspaceId: selectedWorkspaceId,
              agentIds: [agentId],
            }),
          })
          if (!res.ok) {
            const err = await res.json()
            throw new Error(err.error?.message || "Installation failed")
          }
          setInstallSuccess(true)
          setTimeout(() => {
            fetchData()
            setShowInstallModal(false)
            setInstallSuccess(false)
            setSelectedWorkspaceId("")
            setSelectedAgentId("")
          }, 1500)
        },
        {
          message: "Skill installed — applies on next redeploy",
          errorMessage: "Could not install skill",
        },
        showSnackbar,
      )
    } catch (err: unknown) {
      setInstallError(err instanceof Error ? err.message : "Installation failed")
    } finally {
      setIsInstalling(false)
    }
  }

  const handleSubmitReview = async () => {
    if (reviewRating === 0) { setReviewError("Please select a rating"); return }
    setIsSubmittingReview(true)
    setReviewError(null)
    try {
      const res = await fetch(`/api/marketplace/skills/${slug}/reviews`, {
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

  if (isLoading) {
    return (
      <PageShell background="secondary">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="space-y-4">
            <div className="h-3 bg-[var(--bg3)] rounded w-24 animate-pulse" />
            <div className="h-6 bg-[var(--bg3)] rounded w-1/3 animate-pulse" />
            <div className="h-4 bg-[var(--bg3)] rounded w-2/3 animate-pulse" />
            <div className="h-60 bg-[var(--bg3)] rounded animate-pulse" />
            <div className="h-32 bg-[var(--bg3)] rounded animate-pulse" />
          </div>
        </div>
      </PageShell>
    )
  }

  if (pendingReview) {
    return (
      <PageShell background="secondary">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <PendingReviewEmptyState />
        </div>
      </PageShell>
    )
  }

  if (error || !data) {
    return (
      <PageShell background="secondary">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <TextLink href="/store?tab=skills" direction="back" className="mb-3 inline-block">Back to skills</TextLink>
          <AlertBanner variant="error">
            <p className="font-medium">{error || "Skill not found"}</p>
          </AlertBanner>
        </div>
      </PageShell>
    )
  }

  const { skill, reviewCount, installStatus, isOwner } = data

  return (
    <PageShell background="secondary">
      <div className="max-w-4xl mx-auto px-4 py-4">
        <TextLink href="/store?tab=skills" direction="back" className="mb-3 inline-block">Back to skills</TextLink>

        {/* Header: title + install */}
        <div className="flex justify-between items-start mb-4">
          <div className="max-w-[520px]">
            <div className="flex gap-2 items-center">
              <TrustBadge tier={skill.trustTier} />
              <span className="text-[10px] font-medium px-2 py-[1px] rounded-[4px] border border-[var(--bd)] text-[var(--tx2)] bg-[var(--bg2)]">
                {skill.category}
              </span>
              <span className="text-[10px] text-[var(--tx3)]">
                {skill.installCount.toLocaleString()} installs
              </span>
            </div>
            <h1 className="text-[22px] font-semibold text-[var(--tx)] mt-[6px]">
              {skill.name}
            </h1>
            <p className="text-[13px] text-[var(--tx2)] mt-1 leading-relaxed">
              {skill.description}
            </p>

            {skill.avgRating != null && skill.avgRating > 0 && (
              <div className="flex items-center gap-1 mt-2 text-[11px] text-[var(--tx3)]">
                <Star size={10} fill="#FFDC6E" stroke="#FFDC6E" aria-hidden="true" />
                {skill.avgRating.toFixed(1)} ({reviewCount} {reviewCount === 1 ? "review" : "reviews"})
              </div>
            )}
          </div>

          <div className="text-right shrink-0 ml-4">
            <PriceDisplay price={skill.price} isFree={skill.isFree} showPlatformFee={false} />
            {(() => {
              const isPaid = !skill.isFree && skill.price != null && skill.price > 0
              if (isOwner && isPaid) {
                return (
                  <p className="text-[11px] text-[var(--tx2)] mt-3">This is your skill</p>
                )
              }
              const needsPurchase = isPaid && !(installStatus?.hasPurchased)
              if (installStatus?.installed) {
                return (
                  <Button disabled className="mt-3 px-6 py-2 text-[13px]">
                    <Check size={14} className="mr-1" aria-hidden="true" />
                    Installed
                  </Button>
                )
              }
              if (needsPurchase && installStatus) {
                return (
                  <Button
                    size="lg"
                    className="mt-3"
                    loading={isPurchasing}
                    onClick={() => void handlePurchase()}
                  >
                    Buy ${skill.price?.toFixed(0)}
                  </Button>
                )
              }
              return (
                <Button
                  size="lg"
                  className="mt-3"
                  onClick={() => {
                    if (!installStatus) {
                      window.location.href = "/auth/signin"
                      return
                    }
                    if (installStatus.workspaces.length === 0) {
                      setInstallError("Create a Claw workspace first, then install this skill.")
                      return
                    }
                    setShowInstallModal(true)
                  }}
                >
                  Install to Workspace
                </Button>
              )
            })()}
            {installError && !showInstallModal && (
              <p className="text-[10px] text-[var(--err)] mt-1 max-w-[200px] ml-auto">{installError}</p>
            )}
          </div>
        </div>

        {/* SKILL.md preview */}
        <div className="border border-[var(--bd)] rounded-[12px] p-[14px] mb-3.5">
          <h2 className="text-[13px] font-semibold text-[var(--tx)] mb-2">
            Instructions (SKILL.md)
          </h2>
          <div className="max-h-[400px] overflow-y-auto rounded-[6px] p-[10px] bg-[var(--bg3)]">
            <pre className="whitespace-pre-wrap break-words text-[11px] font-mono text-[var(--tx2)]">
              {skill.skillMd}
            </pre>
          </div>
        </div>

        {/* Requirements */}
        <div className="border border-[var(--bd)] rounded-[12px] p-[14px] mb-3.5">
          <h2 className="text-[13px] font-semibold text-[var(--tx)] mb-2">Requirements</h2>
          <div className="text-[12px] text-[var(--tx2)] space-y-2">
            <div>
              <span className="font-medium text-[var(--tx)]">
                <Terminal size={12} className="inline mr-1" aria-hidden="true" />
                Binaries:
              </span>{" "}
              {skill.requiredBins.length > 0 ? skill.requiredBins.join(", ") : "None"}
            </div>
            <div>
              <span className="font-medium text-[var(--tx)]">
                <Key size={12} className="inline mr-1" aria-hidden="true" />
                Environment variables:
              </span>
              {skill.requiredEnvVars.length > 0 ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  {skill.requiredEnvVars.map((v) => (
                    <code key={v} className="text-[11px] px-[6px] py-[2px] rounded-[4px] bg-[var(--bg3)]">
                      {v}
                    </code>
                  ))}
                </div>
              ) : (
                <span className="ml-1">None</span>
              )}
            </div>
          </div>
        </div>

        {/* Creator */}
        <div className="mb-3.5">
          <CreatorCard creator={skill.creator} isOfficial={skill.trustTier === "OFFICIAL"} />
        </div>

        {/* Reviews */}
        <div className="mb-3.5">
          <div className="flex justify-between items-center mb-2">
            <h2 className="text-[13px] font-semibold text-[var(--tx)]">Reviews</h2>
            {reviewCount > 0 && skill.avgRating != null && (
              <span className="text-[12px] text-[var(--tx3)] flex items-center gap-1">
                <Star size={10} fill="#FFDC6E" stroke="#FFDC6E" aria-hidden="true" />
                {skill.avgRating.toFixed(1)} ({reviewCount})
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
              className="text-[12px] text-[var(--ac-text)] hover:text-[var(--tx)] cursor-pointer mt-2 bg-transparent border-0 p-0"
            >
              Show all {reviewCount} reviews
            </button>
          )}

          {showAllReviews && isLoadingReviews && (
            <p className="text-[11px] text-[var(--tx3)] mt-2">Loading more reviews...</p>
          )}

          {installStatus?.installed && !isOwner && (
            <Button variant="outline" size="sm" className="mt-3" onClick={() => setShowReviewModal(true)}>
              Write a review
            </Button>
          )}
        </div>

        {/* OpenClaw version */}
        {skill.minOpenClawVersion && (
          <div className="flex items-center gap-1 text-[11px] text-[var(--tx3)] mt-4 mb-2">
            <Info size={12} aria-hidden="true" />
            Compatible with OpenClaw ≥ {skill.minOpenClawVersion}
          </div>
        )}
      </div>

      {/* Install Modal */}
      <Modal
        open={showInstallModal}
        onClose={() => {
          setShowInstallModal(false)
          setInstallError(null)
          setInstallSuccess(false)
          setSelectedWorkspaceId("")
          setSelectedAgentId("")
        }}
        title={`Install ${data.skill.name}`}
        size="sm"
      >
        {installSuccess ? (
          <div className="text-center py-4">
            <Check size={24} className="mx-auto mb-2 text-[var(--ok)]" />
            <p className="text-[13px] font-semibold text-[var(--ok)]">Skill installed successfully!</p>
            <p className="text-[11px] text-[var(--tx2)] mt-1">
              Attached to the selected agent. Applies on next redeploy (SKILL.md is written by the generator).
            </p>
          </div>
        ) : (
          <>
            {installError && <AlertBanner variant="error">{installError}</AlertBanner>}
            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-medium text-[var(--tx2)] mb-1 block">Choose workspace</label>
                <CustomSelect
                  value={selectedWorkspaceId}
                  onChange={(id) => {
                    setSelectedWorkspaceId(id)
                    setSelectedAgentId("")
                  }}
                  placeholder="Select a workspace..."
                  options={installStatus?.workspaces.map((ws) => ({ value: ws.id, label: ws.name })) || []}
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-[var(--tx2)] mb-1 block">
                  Attach to agent <span className="text-[var(--tx3)]">(default: Orchestrator)</span>
                </label>
                <CustomSelect
                  value={selectedAgentId || defaultAgentId}
                  onChange={setSelectedAgentId}
                  placeholder={selectedWorkspaceId ? "Select an agent..." : "Select a workspace first"}
                  options={workspaceAgents.map((a) => ({
                    value: a.id,
                    label: a.role === "ORCHESTRATOR" ? `${a.name} (Orchestrator)` : a.name,
                  }))}
                />
              </div>
              {skill.requiredEnvVars.length > 0 && (
                <p className="text-[11px] text-[var(--tx3)]">
                  Env required: {skill.requiredEnvVars.join(", ")}. Missing values show as PENDING until
                  connected — then redeploy.
                </p>
              )}
              <p className="text-[11px] text-[var(--tx3)]">
                Install writes the skill + agent attach now. Runtime applies on next redeploy.
              </p>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" onClick={() => setShowInstallModal(false)}>Cancel</Button>
              <Button
                onClick={handleInstall}
                loading={isInstalling}
                disabled={!selectedWorkspaceId || !(selectedAgentId || defaultAgentId)}
              >
                Install to Workspace
              </Button>
            </div>
          </>
        )}
      </Modal>

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
              placeholder="Share your experience with this skill..."
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
    </PageShell>
  )
}
