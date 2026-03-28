"use client"

import { Suspense, useState, useEffect, useCallback, useRef } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { Check, ChevronRight, AlertTriangle, Info, Send } from "lucide-react"
import { PageShell } from "@/components/shared/page-shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AlertBanner } from "@/components/ui/alert-banner"
import { TrustBadge, PriceDisplay, CreatorCard } from "@/components/marketplace"

const STEPS = ["Details", "Pricing", "Preview", "Submit"] as const
const CATEGORIES = [
  { value: "MONEY_MAKING", label: "Money-Making" },
  { value: "CREATOR", label: "Creator" },
  { value: "BUSINESS_OPS", label: "Business Ops" },
  { value: "VERTICAL", label: "Vertical" },
  { value: "LIFESTYLE", label: "Lifestyle" },
]

interface WorkspaceOption {
  id: string
  name: string
  agentCount: number
}

interface CreatorInfo {
  id: string
  displayName: string
}

function PublishContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [currentStep, setCurrentStep] = useState(0)
  const [isCheckingAuth, setIsCheckingAuth] = useState(true)
  const [creatorProfile, setCreatorProfile] = useState<CreatorInfo | null>(null)

  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([])
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("")

  const [name, setName] = useState("")
  const [nameAvailable, setNameAvailable] = useState<boolean | null>(null)
  const [nameCheckError, setNameCheckError] = useState<string | null>(null)
  const [tagline, setTagline] = useState("")
  const [description, setDescription] = useState("")
  const [category, setCategory] = useState("")
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState("")
  const [estimatedCost, setEstimatedCost] = useState("")

  const [isFree, setIsFree] = useState(true)
  const [price, setPrice] = useState<number | "">("")

  const [isPublishing, setIsPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [publishSuccess, setPublishSuccess] = useState(false)
  const [publishedSlug, setPublishedSlug] = useState<string | null>(null)

  const nameCheckTimeout = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    fetch("/api/creator/profile")
      .then((r) => r.json())
      .then((json) => {
        const d = json.data ?? json
        if (!d.enrolled) { router.push("/settings?tab=creator"); return }
        setCreatorProfile({ id: d.profile.id, displayName: d.profile.displayName })
        return fetch("/api/workspaces")
      })
      .then((r) => r?.json())
      .then((json) => {
        if (!json) return
        const data = (json.data ?? json) as Array<{ id: string; name: string; _count: { agents: number } }>
        const ws = data
          .filter((w) => w._count.agents > 0)
          .map((w) => ({ id: w.id, name: w.name, agentCount: w._count.agents }))
        setWorkspaces(ws)
        const urlWs = searchParams.get("workspaceId")
        if (urlWs && ws.some((w) => w.id === urlWs)) setSelectedWorkspaceId(urlWs)
        setIsCheckingAuth(false)
      })
      .catch(() => { router.push("/auth/signin") })
  }, [router, searchParams])

  const checkName = useCallback((value: string) => {
    if (nameCheckTimeout.current) clearTimeout(nameCheckTimeout.current)
    if (value.trim().length < 3) { setNameAvailable(null); setNameCheckError(null); return }
    nameCheckTimeout.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/marketplace/templates/check-name?name=${encodeURIComponent(value.trim())}`)
        const json = await res.json()
        const d = json.data ?? json
        setNameAvailable(d.available)
        setNameCheckError(d.available ? null : d.reason)
      } catch { setNameAvailable(null) }
    }, 400)
  }, [])

  const handleNameChange = (value: string) => { setName(value); checkName(value) }

  const handleAddTag = () => {
    const t = tagInput.trim()
    if (t && tags.length < 5 && !tags.includes(t)) { setTags([...tags, t]); setTagInput("") }
  }

  const canProceed = (): boolean => {
    switch (currentStep) {
      case 0: return name.trim().length >= 3 && nameAvailable === true && tagline.trim().length >= 5 && description.trim().length >= 20 && !!category && !!selectedWorkspaceId
      case 1: return isFree || (typeof price === "number" && price >= 19)
      case 2: return true
      case 3: return !isPublishing
      default: return false
    }
  }

  const handlePublish = async () => {
    setIsPublishing(true)
    setPublishError(null)
    try {
      const res = await fetch("/api/marketplace/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(), tagline: tagline.trim(), description: description.trim(),
          category, tags, estimatedMonthlyCost: estimatedCost.trim() || null,
          isFree, price: isFree ? null : price, workspaceId: selectedWorkspaceId,
        }),
      })
      const json = await res.json()
      if (!res.ok) { throw new Error(json.error?.message ?? json.data?.error ?? "Publishing failed") }
      const d = json.data ?? json
      setPublishedSlug(d.slug)
      setPublishSuccess(true)
    } catch (err: unknown) {
      setPublishError(err instanceof Error ? err.message : "Publishing failed")
    }
    setIsPublishing(false)
  }

  if (isCheckingAuth) {
    return (
      <PageShell>
        <div className="max-w-2xl mx-auto px-4 py-4">
          <div className="space-y-4">
            <div className="h-6 bg-[var(--bg3)] rounded w-1/3 animate-pulse" />
            <div className="h-40 bg-[var(--bg3)] rounded animate-pulse" />
          </div>
        </div>
      </PageShell>
    )
  }

  return (
    <PageShell>
      <div className="max-w-2xl mx-auto px-4 py-4">
        {/* Progress bar */}
        <div className="flex items-center gap-2 mb-6">
          {STEPS.map((step, i) => (
            <div key={step} className="flex items-center gap-2">
              <div className={`flex items-center gap-1 text-[11px] font-medium ${i < currentStep ? "text-[var(--ok)]" : i === currentStep ? "text-[var(--tx)]" : "text-[var(--tx3)]"}`}>
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-semibold ${i < currentStep ? "bg-[var(--ok)] text-white" : i === currentStep ? "bg-[var(--tx)] text-[var(--bg)]" : "bg-[var(--bg3)] text-[var(--tx3)]"}`}>
                  {i < currentStep ? <Check size={10} aria-hidden="true" /> : i + 1}
                </div>
                {step}
              </div>
              {i < STEPS.length - 1 && <ChevronRight size={12} className="text-[var(--tx3)]" aria-hidden="true" />}
            </div>
          ))}
        </div>

        {/* Step 1: Details */}
        {currentStep === 0 && (
          <div className="space-y-3">
            <h2 className="text-[16px] font-semibold text-[var(--tx)]">Template Details</h2>
            <div>
              <label className="text-[11px] font-medium text-[var(--tx2)] mb-1 block">Workspace to publish *</label>
              <select value={selectedWorkspaceId} onChange={(e) => setSelectedWorkspaceId(e.target.value)} className="w-full px-[10px] py-2 border border-[var(--bd)] rounded-[6px] text-[12px] text-[var(--tx)] bg-[var(--bg)] focus:border-[var(--tx)] focus:outline-none">
                <option value="">Select a workspace...</option>
                {workspaces.map((ws) => <option key={ws.id} value={ws.id}>{ws.name} ({ws.agentCount} agents)</option>)}
              </select>
              {workspaces.length === 0 && <p className="text-[11px] text-[var(--tx3)] mt-1">No workspaces with agents found. <Link href="/my-claws" className="text-[var(--ac)]">Build a Claw first.</Link></p>}
            </div>
            <div>
              <label className="text-[11px] font-medium text-[var(--tx2)] mb-1 block">Name *</label>
              <Input value={name} onChange={(e) => handleNameChange(e.target.value)} placeholder="e.g., Social Media Manager" maxLength={100} error={!!nameCheckError} />
              {nameCheckError && <p className="text-[11px] text-[var(--err)] mt-1 flex items-center gap-1"><AlertTriangle size={10} aria-hidden="true" /> {nameCheckError}</p>}
              {nameAvailable === true && name.trim().length >= 3 && <p className="text-[11px] text-[var(--ok)] mt-1 flex items-center gap-1"><Check size={10} aria-hidden="true" /> Name available</p>}
            </div>
            <div>
              <label className="text-[11px] font-medium text-[var(--tx2)] mb-1 block">Tagline * <span className="text-[var(--tx3)]">(max 100)</span></label>
              <Input value={tagline} onChange={(e) => setTagline(e.target.value)} placeholder="One sentence about what this Claw does" maxLength={100} />
            </div>
            <div>
              <label className="text-[11px] font-medium text-[var(--tx2)] mb-1 block">Description *</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Full description of your template" maxLength={5000} rows={5} className="w-full px-[10px] py-2 border border-[var(--bd)] rounded-[6px] text-[12px] text-[var(--tx)] bg-[var(--bg)] resize-none focus:border-[var(--tx)] focus:outline-none" />
              <p className="text-[10px] text-[var(--tx3)] mt-1">{description.length}/5000</p>
            </div>
            <div>
              <label className="text-[11px] font-medium text-[var(--tx2)] mb-1 block">Category *</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)} className="w-full px-[10px] py-2 border border-[var(--bd)] rounded-[6px] text-[12px] text-[var(--tx)] bg-[var(--bg)] focus:border-[var(--tx)] focus:outline-none">
                <option value="">Select category...</option>
                {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-medium text-[var(--tx2)] mb-1 block">Tags <span className="text-[var(--tx3)]">(up to 5)</span></label>
              <div className="flex gap-2">
                <Input value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddTag() } }} placeholder="Add a tag..." maxLength={30} disabled={tags.length >= 5} />
                <Button variant="outline" size="sm" onClick={handleAddTag} disabled={tags.length >= 5 || !tagInput.trim()}>Add</Button>
              </div>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {tags.map((tag, i) => (
                    <span key={i} className="inline-flex items-center gap-1 text-[10px] px-2 py-[2px] rounded-[4px] bg-[var(--bg3)] text-[var(--tx2)]">
                      {tag}
                      <button onClick={() => setTags(tags.filter((_, j) => j !== i))} className="text-[var(--tx3)] hover:text-[var(--tx)] bg-transparent border-0 p-0 cursor-pointer" aria-label={`Remove tag ${tag}`}>x</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="text-[11px] font-medium text-[var(--tx2)] mb-1 block">Estimated Monthly LLM Cost <span className="text-[var(--tx3)]">(optional)</span></label>
              <Input value={estimatedCost} onChange={(e) => setEstimatedCost(e.target.value)} placeholder="e.g., $40-80" />
            </div>
          </div>
        )}

        {/* Step 2: Pricing */}
        {currentStep === 1 && (
          <div className="space-y-3">
            <h2 className="text-[16px] font-semibold text-[var(--tx)]">Set Your Price</h2>
            <div className="space-y-2">
              <label className={`flex items-start gap-3 p-3 border rounded-[12px] cursor-pointer ${isFree ? "border-[var(--tx)] bg-[var(--bg2)]" : "border-[var(--bd)]"}`}>
                <input type="radio" name="pricing" checked={isFree} onChange={() => { setIsFree(true); setPrice("") }} className="mt-1" />
                <div>
                  <div className="text-[13px] font-semibold text-[var(--tx)]">Free</div>
                  <p className="text-[11px] text-[var(--tx2)]">Anyone can install. Great for building reputation.</p>
                </div>
              </label>
              <label className={`flex items-start gap-3 p-3 border rounded-[12px] cursor-pointer ${!isFree ? "border-[var(--tx)] bg-[var(--bg2)]" : "border-[var(--bd)]"}`}>
                <input type="radio" name="pricing" checked={!isFree} onChange={() => setIsFree(false)} className="mt-1" />
                <div className="flex-1">
                  <div className="text-[13px] font-semibold text-[var(--tx)]">Paid</div>
                  <p className="text-[11px] text-[var(--tx2)]">Set a price. You keep 100% minus ~3-5% processing.</p>
                  {!isFree && (
                    <div className="mt-2">
                      <Input type="number" value={price} onChange={(e) => setPrice(e.target.value ? Number(e.target.value) : "")} placeholder="49" min={19} />
                      <p className="text-[10px] text-[var(--tx3)] mt-1">Minimum $19. {typeof price === "number" && price >= 19 && `You receive ~$${Math.round(price * 0.96)} per sale.`}</p>
                    </div>
                  )}
                </div>
              </label>
            </div>
          </div>
        )}

        {/* Step 3: Preview */}
        {currentStep === 2 && (
          <div className="space-y-3">
            <h2 className="text-[16px] font-semibold text-[var(--tx)]">Preview Your Listing</h2>
            <div className="border border-[var(--bd)] rounded-[12px] p-4">
              <div className="flex gap-2 items-center mb-2">
                <TrustBadge tier="UNREVIEWED" />
                {category && <span className="text-[10px] font-medium px-2 py-[1px] rounded-[4px] border border-[var(--bd)] text-[var(--tx2)] bg-[var(--bg2)]">{CATEGORIES.find((c) => c.value === category)?.label}</span>}
              </div>
              <h3 className="text-[18px] font-semibold text-[var(--tx)]">{name || "Template Name"}</h3>
              <p className="text-[12px] text-[var(--tx2)] mt-1">{tagline || "Tagline"}</p>
              <div className="mt-3 pt-3 border-t border-[var(--bd)]">
                <PriceDisplay price={isFree ? null : (typeof price === "number" ? price : null)} isFree={isFree} showPlatformFee={false} />
              </div>
              {creatorProfile && (
                <div className="mt-3">
                  <CreatorCard creator={{ id: creatorProfile.id, displayName: creatorProfile.displayName }} isOfficial={false} />
                </div>
              )}
            </div>
            <p className="text-[11px] text-[var(--tx3)] flex items-center gap-1">
              <Info size={12} aria-hidden="true" />
              Your template will be listed as &quot;Unreviewed&quot; immediately. We&apos;ll review it for &quot;Verified&quot; status.
            </p>
          </div>
        )}

        {/* Step 4: Submit */}
        {currentStep === 3 && (
          publishSuccess ? (
            <div className="text-center py-6">
              <Check size={32} className="mx-auto mb-3 text-[var(--ok)]" aria-hidden="true" />
              <h2 className="text-[18px] font-semibold text-[var(--tx)]">Template Published!</h2>
              <p className="text-[12px] text-[var(--tx2)] mt-1">Listed as Unreviewed. We&apos;ll review it soon.</p>
              <div className="flex justify-center gap-2 mt-4">
                {publishedSlug && <Link href={`/store/${publishedSlug}`}><Button variant="outline">View in Marketplace</Button></Link>}
                <Link href="/settings?tab=creator"><Button variant="outline">Creator Dashboard</Button></Link>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <h2 className="text-[16px] font-semibold text-[var(--tx)]">Publish Your Template</h2>
              {publishError && <AlertBanner variant="error">{publishError}</AlertBanner>}
              <div className="border border-[var(--bd)] rounded-[12px] p-4 space-y-2">
                {[
                  ["Name", name],
                  ["Category", CATEGORIES.find((c) => c.value === category)?.label ?? category],
                  ["Price", isFree ? "Free" : `$${price}`],
                  ["Workspace", workspaces.find((w) => w.id === selectedWorkspaceId)?.name ?? ""],
                ].map(([label, val]) => (
                  <div key={label} className="flex items-center gap-2 text-[12px]">
                    <Check size={14} className="text-[var(--ok)]" aria-hidden="true" />
                    <span className="font-medium text-[var(--tx)]">{label}:</span>
                    <span className="text-[var(--tx2)]">{val}</span>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-[var(--tx3)]">By publishing, you agree to the Creator Terms.</p>
              <Button className="w-full" onClick={handlePublish} loading={isPublishing}>
                <Send size={14} className="mr-1" aria-hidden="true" /> Publish Template
              </Button>
            </div>
          )
        )}

        {/* Navigation */}
        {!publishSuccess && (
          <div className="flex justify-between mt-4">
            <Button variant="outline" onClick={() => setCurrentStep(Math.max(0, currentStep - 1))} disabled={currentStep === 0}>Back</Button>
            {currentStep < 3 && (
              <Button onClick={() => setCurrentStep(currentStep + 1)} disabled={!canProceed()}>
                Next: {STEPS[currentStep + 1]} →
              </Button>
            )}
          </div>
        )}
      </div>
    </PageShell>
  )
}

export default function PublishTemplatePage() {
  return (
    <Suspense fallback={
      <PageShell>
        <div className="max-w-2xl mx-auto px-4 py-4">
          <div className="h-6 bg-[var(--bg3)] rounded w-1/3 animate-pulse" />
          <div className="h-40 bg-[var(--bg3)] rounded animate-pulse mt-4" />
        </div>
      </PageShell>
    }>
      <PublishContent />
    </Suspense>
  )
}
