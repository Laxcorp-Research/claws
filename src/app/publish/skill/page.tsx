"use client"

import { Suspense, useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Check, ChevronRight, AlertTriangle, Send, FileText, Shield, Terminal, Key, XCircle } from "lucide-react"
import { PageShell } from "@/components/shared/page-shell"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AlertBanner } from "@/components/ui/alert-banner"
import { CustomSelect } from "@/components/ui/custom-select"
import { WizardProgressBar } from "@/components/setup/wizard-progress-bar"
import { formatCurrency } from "@/lib/utils/format"
import { commitChipDraft, isEnvChipToken } from "@/lib/marketplace/chip-commit"

const STEPS = ["Details", "SKILL.md", "Pricing", "Submit"] as const

const SKILL_CATEGORIES = [
  { value: "CORE", label: "Core" },
  { value: "CRM", label: "CRM" },
  { value: "EMAIL_SENDER", label: "Email" },
  { value: "SOCIAL", label: "Social" },
  { value: "CALENDAR", label: "Calendar" },
  { value: "PROJECT_MGMT", label: "Project Mgmt" },
  { value: "ANALYTICS", label: "Analytics" },
  { value: "SEARCH", label: "Search" },
  { value: "FINANCE", label: "Finance" },
  { value: "TRADING", label: "Trading" },
  { value: "CONTENT", label: "Content" },
  { value: "COMMUNICATION", label: "Communication" },
  { value: "SECURITY", label: "Security" },
  { value: "CUSTOM", label: "Custom" },
]

interface ScanFinding {
  severity: string
  line: number
  description: string
}

function PublishSkillContent() {
  const router = useRouter()

  const [currentStep, setCurrentStep] = useState(0)
  const [isCheckingAuth, setIsCheckingAuth] = useState(true)

  const [name, setName] = useState("")
  const [emoji, setEmoji] = useState("")
  const [description, setDescription] = useState("")
  const [category, setCategory] = useState("")
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState("")
  const [bins, setBins] = useState<string[]>([])
  const [binInput, setBinInput] = useState("")
  const [envVars, setEnvVars] = useState<string[]>([])
  const [envVarInput, setEnvVarInput] = useState("")

  const [skillMd, setSkillMd] = useState("")

  const [isFree, setIsFree] = useState(true)
  const [price, setPrice] = useState<number | "">("")

  const [attemptedNext, setAttemptedNext] = useState(false)
  const [isPublishing, setIsPublishing] = useState(false)
  const [publishError, setPublishError] = useState<string | null>(null)
  const [publishSuccess, setPublishSuccess] = useState(false)
  const [publishedSlug, setPublishedSlug] = useState<string | null>(null)
  const [scanFailed, setScanFailed] = useState(false)
  const [scanFindings, setScanFindings] = useState<ScanFinding[]>([])
  const [extractionPreview, setExtractionPreview] = useState<{
    requiredBins: string[]
    requiredEnvVars: string[]
    mismatchNote: string | null
    scanPassed: boolean
    findingCount: number
  } | null>(null)
  const [extractionLoading, setExtractionLoading] = useState(false)

  useEffect(() => {
    fetch("/api/creator/profile")
      .then((r) => r.json())
      .then((json) => {
        const d = json.data ?? json
        if (!d.enrolled) { router.push("/settings?tab=creator"); return }
        setIsCheckingAuth(false)
      })
      .catch(() => { router.push("/auth/signin") })
  }, [router])

  // PR-3: scan-preview surfaces bins/env extraction on the SKILL.md step.
  useEffect(() => {
    if (currentStep !== 1 || skillMd.trim().length < 20) {
      setExtractionPreview(null)
      return
    }
    const timer = setTimeout(async () => {
      setExtractionLoading(true)
      try {
        const res = await fetch("/api/marketplace/skills/scan-preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            skillMd: skillMd.trim(),
            requiredBins: bins,
            requiredEnvVars: envVars,
          }),
        })
        const json = await res.json()
        if (!res.ok) {
          setExtractionPreview(null)
          return
        }
        const d = json.data ?? json
        setExtractionPreview({
          requiredBins: d.merged?.requiredBins ?? d.extraction?.requiredBins ?? [],
          requiredEnvVars: d.merged?.requiredEnvVars ?? d.extraction?.requiredEnvVars ?? [],
          mismatchNote: d.mismatchNote ?? null,
          scanPassed: !!d.scanPassed,
          findingCount: Array.isArray(d.findings) ? d.findings.length : 0,
        })
      } catch {
        setExtractionPreview(null)
      } finally {
        setExtractionLoading(false)
      }
    }, 450)
    return () => clearTimeout(timer)
  }, [currentStep, skillMd, bins, envVars])

  const addItem = (input: string, setInput: (v: string) => void, items: string[], setItems: (v: string[]) => void, max: number, isValid?: (token: string) => boolean) => {
    const next = commitChipDraft(input, items, max, isValid)
    setItems(next.items)
    setInput(next.draft)
  }

  const flushPendingChips = () => {
    const t = commitChipDraft(tagInput, tags, 5)
    const b = commitChipDraft(binInput, bins, 20)
    const e = commitChipDraft(envVarInput, envVars, 20, isEnvChipToken)
    setTags(t.items); setTagInput(t.draft)
    setBins(b.items); setBinInput(b.draft)
    setEnvVars(e.items); setEnvVarInput(e.draft)
  }

  const canProceed = (): boolean => {
    switch (currentStep) {
      case 0: return name.trim().length >= 2 && description.trim().length >= 10 && !!category
      case 1: return skillMd.trim().length >= 20
      case 2: return isFree || (typeof price === "number" && price >= 5)
      case 3: return !isPublishing
      default: return false
    }
  }

  const handlePublish = async () => {
    const t = commitChipDraft(tagInput, tags, 5)
    const b = commitChipDraft(binInput, bins, 20)
    const e = commitChipDraft(envVarInput, envVars, 20, isEnvChipToken)
    setTags(t.items); setTagInput(t.draft)
    setBins(b.items); setBinInput(b.draft)
    setEnvVars(e.items); setEnvVarInput(e.draft)
    setIsPublishing(true)
    setPublishError(null)
    setScanFailed(false)
    setScanFindings([])
    try {
      const res = await fetch("/api/marketplace/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(), emoji: emoji.trim() || null, description: description.trim(),
          category, tags: t.items, requiredBins: b.items, requiredEnvVars: e.items,
          skillMd: skillMd.trim(), isFree, price: isFree ? null : price,
        }),
      })
      const json = await res.json()
      if (res.status === 422) {
        setScanFailed(true)
        setScanFindings(json.findings ?? [])
        setIsPublishing(false)
        return
      }
      if (!res.ok) { throw new Error(json.error?.message ?? "Publishing failed") }
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
        <div className="mb-6">
          <WizardProgressBar steps={STEPS.map((label, i) => ({
            label,
            status: i < currentStep ? "complete" as const : i === currentStep ? "current" as const : "upcoming" as const,
          }))} />
        </div>

        {/* Step 1: Details */}
        {currentStep === 0 && (
          <div className="space-y-3">
            <h2 className="text-[16px] font-semibold text-[var(--tx)]">Skill Details</h2>
            <div>
              <label className="text-[11px] font-medium text-[var(--tx2)] mb-1 block">Name *</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g., HubSpot Contact Sync" maxLength={80} />
            </div>
            <div>
              <label className="text-[11px] font-medium text-[var(--tx2)] mb-1 block">Emoji <span className="text-[var(--tx3)]">(optional)</span></label>
              <Input value={emoji} onChange={(e) => setEmoji(e.target.value)} placeholder="e.g., a relevant emoji" maxLength={4} className="max-w-[80px]" />
            </div>
            <div>
              <label className="text-[11px] font-medium text-[var(--tx2)] mb-1 block">Description *</label>
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What does this skill do? When should an agent use it?" maxLength={1000} rows={3} className="w-full px-[10px] py-2 border border-[var(--bd)] rounded-[6px] text-[12px] text-[var(--tx)] bg-[var(--bg)] resize-none focus:border-[var(--tx)] focus:outline-none" />
              <p className={`text-[10px] mt-1 ${description.length > 0 && description.length < 10 ? "text-[var(--err)]" : "text-[var(--tx3)]"}`}>
                {description.length > 0 && description.length < 10 ? `Minimum 10 characters required (${description.length}/10)` : `${description.length}/1000`}
              </p>
            </div>
            <div>
              <label className="text-[11px] font-medium text-[var(--tx2)] mb-1 block">Category *</label>
              <CustomSelect value={category} onChange={setCategory} placeholder="Select category..." options={SKILL_CATEGORIES} />
            </div>
            <div>
              <label className="text-[11px] font-medium text-[var(--tx2)] mb-1 block">Tags <span className="text-[var(--tx3)]">(up to 5)</span></label>
              <div className="flex gap-2">
                <Input value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addItem(tagInput, setTagInput, tags, setTags, 5) } }} onBlur={() => { flushPendingChips() }} placeholder="Add a tag..." maxLength={30} disabled={tags.length >= 5} />
                <Button variant="outline" size="sm" onClick={() => addItem(tagInput, setTagInput, tags, setTags, 5)} disabled={tags.length >= 5 || !tagInput.trim()}>Add</Button>
              </div>
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {tags.map((tag, i) => (
                    <span key={i} className="inline-flex items-center gap-1 text-[10px] px-2 py-[2px] rounded-[4px] bg-[var(--bg3)] text-[var(--tx2)]">
                      {tag}
                      <button onClick={() => setTags(tags.filter((_, j) => j !== i))} className="text-[var(--tx3)] hover:text-[var(--tx)] bg-transparent border-0 p-0 cursor-pointer" aria-label={`Remove ${tag}`}>x</button>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="text-[11px] font-medium text-[var(--tx2)] mb-1 block"><Terminal size={10} className="inline mr-1" aria-hidden="true" />Required Binaries <span className="text-[var(--tx3)]">(optional)</span></label>
              <div className="flex gap-2">
                <Input value={binInput} onChange={(e) => setBinInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addItem(binInput, setBinInput, bins, setBins, 20) } }} onBlur={() => { flushPendingChips() }} placeholder="curl" maxLength={50} disabled={bins.length >= 20} />
                <Button variant="outline" size="sm" onClick={() => addItem(binInput, setBinInput, bins, setBins, 20)} disabled={bins.length >= 20 || !binInput.trim()}>Add</Button>
              </div>
              {bins.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {bins.map((b, i) => (
                    <code key={i} className="inline-flex items-center gap-1 text-[10px] px-2 py-[2px] rounded-[4px] bg-[var(--bg3)] text-[var(--tx)]">
                      {b}
                      <button onClick={() => setBins(bins.filter((_, j) => j !== i))} className="text-[var(--tx3)] hover:text-[var(--tx)] bg-transparent border-0 p-0 cursor-pointer" aria-label={`Remove ${b}`}>x</button>
                    </code>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label className="text-[11px] font-medium text-[var(--tx2)] mb-1 block"><Key size={10} className="inline mr-1" aria-hidden="true" />Required Environment Variables <span className="text-[var(--tx3)]">(UPPER_SNAKE_CASE)</span></label>
              <div className="flex gap-2">
                <Input value={envVarInput} onChange={(e) => setEnvVarInput(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addItem(envVarInput, setEnvVarInput, envVars, setEnvVars, 20, isEnvChipToken) } }} onBlur={() => { flushPendingChips() }} placeholder="HUBSPOT_API_KEY" maxLength={100} disabled={envVars.length >= 20} />
                <Button variant="outline" size="sm" onClick={() => { addItem(envVarInput, setEnvVarInput, envVars, setEnvVars, 20, isEnvChipToken) }} disabled={envVars.length >= 20 || !envVarInput.trim() || !isEnvChipToken(envVarInput)}>Add</Button>
              </div>
              {envVarInput && !isEnvChipToken(envVarInput) && envVarInput.length > 0 && (
                <p className="text-[10px] text-[var(--warn)] mt-1">Must start with a letter and contain only A-Z, 0-9, _</p>
              )}
              {envVars.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {envVars.map((v, i) => (
                    <code key={i} className="inline-flex items-center gap-1 text-[10px] px-2 py-[2px] rounded-[4px] bg-[var(--bg3)] text-[var(--tx)]">
                      {v}
                      <button onClick={() => setEnvVars(envVars.filter((_, j) => j !== i))} className="text-[var(--tx3)] hover:text-[var(--tx)] bg-transparent border-0 p-0 cursor-pointer" aria-label={`Remove ${v}`}>x</button>
                    </code>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Step 2: SKILL.md */}
        {currentStep === 1 && (
          <div className="space-y-3">
            <h2 className="text-[16px] font-semibold text-[var(--tx)]">Skill Instructions</h2>
            <p className="text-[12px] text-[var(--tx2)]">Write the SKILL.md content. This is what the agent reads and follows when using your skill.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" style={{ height: "400px" }}>
              <div className="flex flex-col">
                <label className="text-[10px] font-medium text-[var(--tx2)] mb-1">Editor</label>
                <textarea value={skillMd} onChange={(e) => setSkillMd(e.target.value)} placeholder={"When the user or agent needs to...\n\n## Authentication\nAPI key is available as $YOUR_API_KEY.\n\n## Common Operations\n1. First, check if...\n2. Then call..."} className="flex-1 px-3 py-2 border border-[var(--bd)] rounded-[6px] text-[11px] text-[var(--tx)] bg-[var(--bg)] resize-none focus:border-[var(--tx)] focus:outline-none font-mono leading-relaxed" spellCheck={false} />
              </div>
              <div className="flex flex-col">
                <label className="text-[10px] font-medium text-[var(--tx2)] mb-1">Preview</label>
                <div className="flex-1 border border-[var(--bd)] rounded-[6px] p-3 overflow-y-auto text-[11px] text-[var(--tx2)] leading-relaxed bg-[var(--bg2)]">
                  {skillMd.trim() ? (
                    <pre className="whitespace-pre-wrap break-words font-mono text-[11px]">{skillMd}</pre>
                  ) : (
                    <p className="italic text-[var(--tx3)]">Preview will appear here as you type...</p>
                  )}
                </div>
              </div>
            </div>
            <p className="text-[10px] text-[var(--tx3)]">{skillMd.length.toLocaleString()} / 50,000 characters</p>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-[var(--tx3)]">OR</span>
              <label className="text-[11px] text-[var(--ac-text)] hover:text-[var(--tx)] cursor-pointer flex items-center gap-1">
                <FileText size={12} aria-hidden="true" /> Upload SKILL.md file
                <input type="file" accept=".md,.txt" className="hidden" onChange={async (e) => {
                  const file = e.target.files?.[0]
                  if (!file) return
                  if (file.size > 50000) return
                  setSkillMd(await file.text())
                }} />
              </label>
            </div>
            {(extractionLoading || extractionPreview) && (
              <div className="border border-[var(--bd)] rounded-[12px] p-3 space-y-2">
                <div className="flex items-center gap-2 text-[12px] font-semibold text-[var(--tx)]">
                  <Shield size={12} aria-hidden="true" />
                  Scan preview
                  {extractionLoading && <span className="text-[10px] font-normal text-[var(--tx3)]">Analyzing…</span>}
                </div>
                {extractionPreview && (
                  <>
                    <p className="text-[11px] text-[var(--tx2)]">
                      Auto-scan: {extractionPreview.scanPassed ? "passed" : "failed"}
                      {extractionPreview.findingCount > 0
                        ? ` · ${extractionPreview.findingCount} finding${extractionPreview.findingCount === 1 ? "" : "s"}`
                        : ""}
                    </p>
                    <div className="text-[11px] text-[var(--tx2)]">
                      <span className="font-medium text-[var(--tx)]">Detected bins:</span>{" "}
                      {extractionPreview.requiredBins.length
                        ? extractionPreview.requiredBins.join(", ")
                        : "none"}
                    </div>
                    <div className="text-[11px] text-[var(--tx2)]">
                      <span className="font-medium text-[var(--tx)]">Detected env vars:</span>{" "}
                      {extractionPreview.requiredEnvVars.length
                        ? extractionPreview.requiredEnvVars.join(", ")
                        : "none"}
                    </div>
                    {extractionPreview.mismatchNote && (
                      <AlertBanner variant="warning">
                        <p className="text-[11px]">
                          Declared vs extracted mismatch (will be noted for reviewers): {extractionPreview.mismatchNote}
                        </p>
                      </AlertBanner>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Step 3: Pricing */}
        {currentStep === 2 && (
          <div className="space-y-3">
            <h2 className="text-[16px] font-semibold text-[var(--tx)]">Set Your Price</h2>
            <div className="space-y-2">
              <label className={`flex items-start gap-3 p-3 border rounded-[12px] cursor-pointer ${isFree ? "border-[var(--tx)] bg-[var(--bg2)]" : "border-[var(--bd)]"}`}>
                <input type="radio" name="pricing" checked={isFree} onChange={() => { setIsFree(true); setPrice("") }} className="mt-1" />
                <div>
                  <div className="text-[13px] font-semibold text-[var(--tx)]">Free</div>
                  <p className="text-[11px] text-[var(--tx2)]">Anyone can install. Great for building reputation and gaining installs.</p>
                </div>
              </label>
              <label className={`flex items-start gap-3 p-3 border rounded-[12px] cursor-pointer ${!isFree ? "border-[var(--tx)] bg-[var(--bg2)]" : "border-[var(--bd)]"}`}>
                <input type="radio" name="pricing" checked={!isFree} onChange={() => setIsFree(false)} className="mt-1" />
                <div className="flex-1">
                  <div className="text-[13px] font-semibold text-[var(--tx)]">Paid</div>
                  <p className="text-[11px] text-[var(--tx2)]">Set a price. You keep 100% minus ~3-5% processing.</p>
                  {!isFree && (
                    <div className="mt-2">
                      <Input type="number" value={price} onChange={(e) => { const v = e.target.value ? Number(e.target.value) : ""; if (typeof v === "number" && v < 0) return; setPrice(v) }} placeholder="9" min={0} />
                      {typeof price === "number" && price === 0 && (
                        <p className="text-[10px] text-[var(--err)] mt-1">Paid skills must have a price greater than $0. Choose &quot;Free&quot; for free skills.</p>
                      )}
                      {typeof price === "number" && price > 0 && price < 5 && (
                        <p className="text-[10px] text-[var(--err)] mt-1">Minimum price is $5 for paid skills.</p>
                      )}
                      {(price === "" || (typeof price === "number" && price >= 5)) && (
                        <p className="text-[10px] text-[var(--tx3)] mt-1">Minimum $5. {typeof price === "number" && price >= 5 && `You receive ~${formatCurrency(price * 0.96)} per sale.`}</p>
                      )}
                    </div>
                  )}
                </div>
              </label>
            </div>
          </div>
        )}

        {/* Step 4: Submit */}
        {currentStep === 3 && (
          publishSuccess ? (
            <div className="text-center py-6">
              <Check size={32} className="mx-auto mb-3 text-[var(--ok)]" aria-hidden="true" />
              <h2 className="text-[18px] font-semibold text-[var(--tx)]">Skill Published!</h2>
              <p className="text-[12px] text-[var(--tx2)] mt-1">Auto-scan passed. Submitted for manual review. Not listed until approved.</p>
              <div className="flex justify-center gap-2 mt-4">
                {publishedSlug && <Link href={`/store/skills/${publishedSlug}`}><Button variant="outline">View in Marketplace</Button></Link>}
                <Link href="/settings?tab=creator"><Button variant="outline">Creator Dashboard</Button></Link>
              </div>
            </div>
          ) : scanFailed ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-[var(--err)]">
                <XCircle size={20} aria-hidden="true" />
                <h2 className="text-[16px] font-semibold">Auto-scan found issues</h2>
              </div>
              <p className="text-[12px] text-[var(--tx2)]">Your SKILL.md contains patterns that could pose security risks. Fix the issues below and resubmit.</p>
              <div className="border border-[var(--err)] rounded-[12px] overflow-hidden">
                {scanFindings.map((f, i) => (
                  <div key={i} className={`flex items-start gap-2 px-3 py-2 text-[11px] ${i < scanFindings.length - 1 ? "border-b border-[var(--bd)]" : ""}`}>
                    <span className={`shrink-0 mt-[2px] ${f.severity === "critical" ? "text-[var(--err)]" : "text-[var(--warn)]"}`}>
                      {f.severity === "critical" ? <XCircle size={12} aria-hidden="true" /> : <AlertTriangle size={12} aria-hidden="true" />}
                    </span>
                    <div>
                      <span className={`font-semibold uppercase text-[9px] ${f.severity === "critical" ? "text-[var(--err)]" : "text-[var(--warn)]"}`}>{f.severity}</span>
                      <span className="text-[var(--tx3)] ml-2">Line {f.line}</span>
                      <p className="text-[var(--tx2)] mt-[2px]">{f.description}</p>
                    </div>
                  </div>
                ))}
              </div>
              <Button variant="outline" onClick={() => { setScanFailed(false); setScanFindings([]); setCurrentStep(1) }}>
                Fix and Resubmit
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <h2 className="text-[16px] font-semibold text-[var(--tx)]">Publish Your Skill</h2>
              {publishError && <AlertBanner variant="error">{publishError}</AlertBanner>}
              <div className="border border-[var(--bd)] rounded-[12px] p-4 space-y-2">
                {[
                  ["Name", `${name}${emoji ? ` ${emoji}` : ""}`],
                  ["Category", SKILL_CATEGORIES.find((c) => c.value === category)?.label ?? category],
                  ...(bins.length > 0 ? [["Binaries", bins.join(", ")]] : []),
                  ...(envVars.length > 0 ? [["Env vars", envVars.join(", ")]] : []),
                  ["SKILL.md", `${skillMd.length.toLocaleString()} characters`],
                  ["Price", isFree ? "Free" : `$${price}`],
                ].map(([label, val]) => (
                  <div key={label} className="flex items-center gap-2 text-[12px]">
                    <Check size={14} className="text-[var(--ok)]" aria-hidden="true" />
                    <span className="font-medium text-[var(--tx)]">{label}:</span>
                    <span className="text-[var(--tx2)]">{val}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-start gap-2 p-3 rounded-[12px] bg-[var(--bg2)]">
                <Shield size={14} className="text-[var(--tx3)] shrink-0 mt-[2px]" aria-hidden="true" />
                <p className="text-[11px] text-[var(--tx3)]">Your skill will be auto-scanned for security, then queued for manual review. It will not appear in the marketplace until approved.</p>
              </div>
              <Button className="w-full" onClick={handlePublish} loading={isPublishing}>
                <Send size={14} className="mr-1" aria-hidden="true" /> Publish Skill
              </Button>
            </div>
          )
        )}

        {/* Navigation */}
        {!publishSuccess && !scanFailed && (
          <div className="mt-4">
            {attemptedNext && !canProceed() && currentStep === 0 && (
              <p className="text-[11px] text-[var(--err)] mb-2">
                {name.trim().length < 2 && "Name must be at least 2 characters. "}
                {description.trim().length < 10 && "Description must be at least 10 characters. "}
                {!category && "Select a category. "}
              </p>
            )}
            {attemptedNext && !canProceed() && currentStep === 1 && (
              <p className="text-[11px] text-[var(--err)] mb-2">
                {skillMd.trim().length < 20 && "SKILL.md must be at least 20 characters."}
              </p>
            )}
            {attemptedNext && !canProceed() && currentStep === 2 && !isFree && (
              <p className="text-[11px] text-[var(--err)] mb-2">
                {(typeof price !== "number" || price < 5) && "Set a price of at least $5, or choose Free."}
              </p>
            )}
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => { setCurrentStep(Math.max(0, currentStep - 1)); setAttemptedNext(false) }} disabled={currentStep === 0}>Back</Button>
              {currentStep < 3 && (
                <Button onClick={() => { flushPendingChips(); if (canProceed()) { setCurrentStep(currentStep + 1); setAttemptedNext(false) } else { setAttemptedNext(true) } }}>
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

export default function PublishSkillPage() {
  return (
    <Suspense fallback={
      <PageShell>
        <div className="max-w-2xl mx-auto px-4 py-4">
          <div className="h-6 bg-[var(--bg3)] rounded w-1/3 animate-pulse" />
          <div className="h-40 bg-[var(--bg3)] rounded animate-pulse mt-4" />
        </div>
      </PageShell>
    }>
      <PublishSkillContent />
    </Suspense>
  )
}
