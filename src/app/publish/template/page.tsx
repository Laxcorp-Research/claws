"use client"

import { Suspense, useState, useEffect, useCallback, useRef } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { Check, ChevronRight, AlertTriangle, Info, Send, Loader2, Circle, XCircle, CheckCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { PageShell } from "@/components/shared/page-shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AlertBanner } from "@/components/ui/alert-banner"
import { TruncatedText } from "@/components/ui/truncate-with-tooltip"
import { CustomSelect } from "@/components/ui/custom-select"
import { TrustBadge, PriceDisplay, CreatorCard } from "@/components/marketplace"
import { WizardProgressBar } from "@/components/setup/wizard-progress-bar"

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

  const [attemptedNext, setAttemptedNext] = useState(false)
  const [isPublishing, setIsPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [publishSuccess, setPublishSuccess] = useState(false)
  const [scanFailed, setScanFailed] = useState(false)
  const [scanFindings, setScanFindings] = useState<Array<{ severity: string; agentName: string; file: string; line: number; description: string; matchedText: string }>>([])

  const [scanStep, setScanStep] = useState(0)
  const [scanComplete, setScanComplete] = useState(false)
  const [scanResult, setScanResult] = useState<{ passed: boolean; criticalCount: number; warningCount: number; findings: Array<{ severity: string; agentName: string; file: string; line: number; description: string; matchedText: string }>; llmResult?: { safe: boolean; riskLevel: string; summary: string } | null } | null>(null)
  const [scanError, setScanError] = useState(false)
  const scanRanRef = useRef(false)

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

  const SCAN_STEPS = [
    "Validating template details",
    "Building workspace version",
    "Running pattern scan",
    "AI security review",
    "Generating scan report",
  ]

  const runScan = useCallback(async () => {
    setScanStep(0)
    setScanComplete(false)
    setScanResult(null)
    setScanError(false)
    setScanFailed(false)
    setScanFindings([])

    for (let i = 0; i < SCAN_STEPS.length - 1; i++) {
      setScanStep(i)
      await new Promise(r => setTimeout(r, 500))
    }
    setScanStep(SCAN_STEPS.length - 1)

    try {
      const res = await fetch("/api/marketplace/templates/scan-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: selectedWorkspaceId }),
      })
      if (!res.ok) { setScanError(true); return }
      const json = await res.json()
      const result = json.data?.scanResult ?? json.scanResult
      setScanResult(result)
      if (result && !result.passed) {
        setScanFailed(true)
        setScanFindings(result.findings || [])
      }
    } catch {
      setScanError(true)
    } finally {
      setScanComplete(true)
    }
  }, [selectedWorkspaceId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (currentStep === 3 && !scanRanRef.current && selectedWorkspaceId) {
      scanRanRef.current = true
      runScan()
    }
    if (currentStep !== 3) {
      scanRanRef.current = false
    }
  }, [currentStep, selectedWorkspaceId, runScan])

  const canProceed = (): boolean => {
    switch (currentStep) {
      case 0: return name.trim().length >= 3 && nameAvailable === true && tagline.trim().length >= 5 && description.trim().length >= 20 && !!category && !!selectedWorkspaceId
      case 1: return isFree || (typeof price === "number" && price >= 19)
      case 2: return true
      case 3: return !isPublishing && scanComplete && !!scanResult?.passed
      default: return false
    }
  }

  const handlePublish = async () => {
    setIsPublishing(true)
    setPublishError(null)
    setScanFailed(false)
    setScanFindings([])
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
      if (res.status === 422) {
        setScanFailed(true)
        setScanFindings(json.allFindings ?? json.findings ?? [])
        setIsPublishing(false)
        return
      }
      if (!res.ok) { throw new Error(json.error?.message ?? json.data?.error ?? "Publishing failed") }
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
        <div className="mb-6">
          <WizardProgressBar steps={STEPS.map((label, i) => ({
            label,
            status: i < currentStep ? "complete" as const : i === currentStep ? "current" as const : "upcoming" as const,
          }))} />
        </div>

        {/* Step 1: Details */}
        {currentStep === 0 && (
          <div className="space-y-3">
            <h2 className="text-[16px] font-semibold text-[var(--tx)]">Template Details</h2>
            <div>
              <label className="text-[11px] font-medium text-[var(--tx2)] mb-1 block">Workspace to publish *</label>
              <CustomSelect value={selectedWorkspaceId} onChange={setSelectedWorkspaceId} placeholder="Select a workspace..." options={workspaces.map((ws) => ({ value: ws.id, label: `${ws.name} (${ws.agentCount} agents)` }))} />
              {workspaces.length === 0 && <p className="text-[11px] text-[var(--tx3)] mt-1">No workspaces with agents found. <Link href="/my-claws" className="text-[var(--ac-text)]">Build a Claw first.</Link></p>}
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
              <p className={`text-[10px] mt-1 ${description.length > 0 && description.length < 20 ? "text-[var(--err)]" : "text-[var(--tx3)]"}`}>
                {description.length > 0 && description.length < 20 ? `Minimum 20 characters required (${description.length}/20)` : `${description.length}/5000`}
              </p>
            </div>
            <div>
              <label className="text-[11px] font-medium text-[var(--tx2)] mb-1 block">Category *</label>
              <CustomSelect value={category} onChange={setCategory} placeholder="Select category..." options={CATEGORIES} />
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
                      <Input type="number" value={price} onChange={(e) => { const v = e.target.value ? Number(e.target.value) : ""; if (typeof v === "number" && v < 0) return; setPrice(v) }} placeholder="49" min={0} />
                      {typeof price === "number" && price === 0 && (
                        <p className="text-[10px] text-[var(--err)] mt-1">Paid templates must have a price greater than $0. Choose &quot;Free&quot; for free templates.</p>
                      )}
                      {typeof price === "number" && price > 0 && price < 19 && (
                        <p className="text-[10px] text-[var(--err)] mt-1">Minimum price is $19 for paid templates.</p>
                      )}
                      {(price === "" || (typeof price === "number" && price >= 19)) && (
                        <p className="text-[10px] text-[var(--tx3)] mt-1">Minimum $19. {typeof price === "number" && price >= 19 && `You receive ~$${Math.round(price * 0.96)} per sale.`}</p>
                      )}
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
              Your template is submitted for manual review. It will not appear in the marketplace until approved.
            </p>
          </div>
        )}

        {/* Step 4: Submit */}
        {currentStep === 3 && (
          publishSuccess ? (
            <div className="text-center py-6">
              <Check size={32} className="mx-auto mb-3 text-[var(--ok)]" aria-hidden="true" />
              <h2 className="text-[18px] font-semibold text-[var(--tx)]">Template submitted</h2>
              <p className="text-[12px] text-[var(--tx2)] mt-1">{"Submitted for review — you'll get an email when it's approved."}</p>
              <div className="flex justify-center gap-2 mt-4">
                <Link href="/settings?tab=creator"><Button variant="primary">View in your creator dashboard</Button></Link>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <h2 className="text-[16px] font-semibold text-[var(--tx)]">Security Scan & Publish</h2>

              {/* Scan Progress Steps */}
              <div className="border border-[var(--bd)] rounded-[12px] p-[14px]">
                <h3 className="text-[13px] font-semibold text-[var(--tx)] mb-[10px]">Security scan</h3>
                <div className="flex flex-col gap-[8px]">
                  {SCAN_STEPS.map((step, i) => {
                    let status: "done" | "current" | "pending" | "failed" = "pending"
                    if (scanComplete) {
                      if (scanResult && !scanResult.passed && i === SCAN_STEPS.length - 1) status = "failed"
                      else if (scanError && i === SCAN_STEPS.length - 1) status = "failed"
                      else status = "done"
                    } else if (i < scanStep) {
                      status = "done"
                    } else if (i === scanStep) {
                      status = "current"
                    }
                    return (
                      <div key={i} className="flex items-center gap-[8px]">
                        {status === "done" && <CheckCircle className="w-[16px] h-[16px] text-[var(--ok)] flex-shrink-0" />}
                        {status === "current" && <Loader2 className="w-[16px] h-[16px] animate-spin text-[var(--tx2)] flex-shrink-0" />}
                        {status === "pending" && <Circle className="w-[16px] h-[16px] text-[var(--tx3)] flex-shrink-0" />}
                        {status === "failed" && <XCircle className="w-[16px] h-[16px] text-[var(--err)] flex-shrink-0" />}
                        <span className={cn("text-[12px]", status === "pending" ? "text-[var(--tx3)]" : status === "failed" ? "text-[var(--err)]" : "text-[var(--tx)]")}>
                          {step}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Scan Results */}
              {scanComplete && scanResult?.passed && (
                <div className="border border-[var(--ok)] rounded-[12px] p-[14px] bg-[var(--okbg)]">
                  <div className="flex items-center gap-[8px]">
                    <CheckCircle className="w-[16px] h-[16px] text-[var(--ok)]" />
                    <span className="text-[13px] font-semibold text-[var(--ok)]">Security scan passed</span>
                  </div>
                  {scanResult.llmResult?.summary && (
                    <p className="text-[11px] text-[var(--tx2)] mt-[4px]">{scanResult.llmResult.summary}</p>
                  )}
                  {scanResult.warningCount > 0 && (
                    <p className="text-[12px] text-[#92400e] mt-[4px]">{scanResult.warningCount} warning(s) - review recommended but not blocking</p>
                  )}
                </div>
              )}

              {scanComplete && scanResult && !scanResult.passed && (
                <div className="border border-[var(--err)] rounded-[12px] p-[14px] bg-[var(--errbg)]">
                  <h3 className="text-[13px] font-semibold text-[var(--err)] mb-[8px]">{scanResult.criticalCount} critical issue(s) found</h3>
                  <p className="text-[12px] text-[var(--tx2)] mb-[10px]">Fix these issues in your workspace and resubmit.</p>
                  {scanResult.findings.filter(f => f.severity === "critical").map((f, i) => (
                    <div key={i} className="border border-[var(--err)] rounded-[8px] p-[10px] mb-[6px] bg-[var(--bg)]">
                      <div className="text-[11px]">
                        <span className="font-semibold text-[var(--err)]">CRITICAL</span>
                        <span className="text-[var(--tx2)] ml-[8px]">{f.agentName} - {f.file} line {f.line}</span>
                      </div>
                      <div className="text-[12px] mt-[2px] text-[var(--tx)]">{f.description}</div>
                      {f.matchedText && (
                        <code className="mt-[2px] block min-w-0 text-[10px] text-[var(--tx3)]">
                          <TruncatedText>{f.matchedText}</TruncatedText>
                        </code>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {scanComplete && scanError && (
                <AlertBanner variant="error">Failed to run security scan. Please try again.</AlertBanner>
              )}

              {/* Template Details Checklist */}
              {scanComplete && scanResult?.passed && (
                <>
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
                </>
              )}

              {scanComplete && scanResult && !scanResult.passed && (
                <Button variant="outline" onClick={() => { setScanFailed(false); setScanFindings([]); scanRanRef.current = false; setCurrentStep(0) }}>
                  Fix and Resubmit
                </Button>
              )}

              {scanComplete && scanError && (
                <Button variant="outline" onClick={() => { scanRanRef.current = false; runScan() }}>
                  Retry Scan
                </Button>
              )}
            </div>
          )
        )}

        {/* Navigation */}
        {!publishSuccess && !scanFailed && (
          <div className="mt-4">
            {attemptedNext && !canProceed() && currentStep === 0 && (
              <p className="text-[11px] text-[var(--err)] mb-2">
                {!selectedWorkspaceId && "Select a workspace. "}
                {name.trim().length < 3 && "Name must be at least 3 characters. "}
                {nameAvailable !== true && name.trim().length >= 3 && "Name is not available. "}
                {tagline.trim().length < 5 && "Tagline must be at least 5 characters. "}
                {description.trim().length < 20 && "Description must be at least 20 characters. "}
                {!category && "Select a category. "}
              </p>
            )}
            {attemptedNext && !canProceed() && currentStep === 1 && !isFree && (
              <p className="text-[11px] text-[var(--err)] mb-2">
                {(typeof price !== "number" || price < 19) && "Set a price of at least $19, or choose Free."}
              </p>
            )}
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => { setCurrentStep(Math.max(0, currentStep - 1)); setAttemptedNext(false) }} disabled={currentStep === 0}>Back</Button>
              {currentStep < 3 && (
                <Button onClick={() => { if (canProceed()) { setCurrentStep(currentStep + 1); setAttemptedNext(false) } else { setAttemptedNext(true) } }}>
                  Next: {STEPS[currentStep + 1]} →
                </Button>
              )}
            </div>
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
