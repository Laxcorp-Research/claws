"use client"

import { useState, useEffect, useCallback } from "react"
import { CheckCircle2, XCircle, Circle, X, Eye, ChevronDown, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs } from "@/components/ui/tabs"
import { Modal } from "@/components/ui/modal"
import { Textarea } from "@/components/ui/textarea"
import { EmptyState } from "@/components/ui/empty-state"
import { LoadingSkeleton } from "@/components/ui/loading-skeleton"
import { AdminAccessDenied } from "@/components/admin/admin-access-denied"
import { NetworkError } from "@/components/shared/network-error"
import { useSnackbarOptional } from "@/components/shared/snackbar"
import { mutateWithFeedback } from "@/lib/ui/mutate-with-feedback"
import { SandboxReportViewer } from "@/components/marketplace/sandbox-report-viewer"

interface CreatorInfo {
  id: string
  displayName: string
  avatarUrl: string | null
  user: { email: string } | null
}

interface ReviewTemplate {
  id: string
  name: string
  slug: string
  tagline: string
  description: string
  category: string
  trustTier: string
  reviewStatus: string
  createdAt: string
  creator: CreatorInfo | null
  workspaceSnapshot: string
  autoScanPassed: boolean | null
  autoScanReport: string | null
  reviewNotes: string | null
  isFree: boolean
  price: number
  tags: string[]
  estimatedMonthlyCost: string | null
  agentCount: number
}

interface SnapshotAgent {
  name: string
  role: string
  model: string
  soulMd: string
  agentsMd: string
  heartbeatMd?: string
  skills?: Array<{ slug: string; name: string }>
}

interface SnapshotConnection {
  sourceSlug?: string
  targetSlug?: string
  condition: string
}

function parseSnapshot(raw: string): { agents: SnapshotAgent[]; connections: SnapshotConnection[] } {
  try {
    const data = JSON.parse(raw)
    return { agents: data.agents || [], connections: data.connections || [] }
  } catch {
    return { agents: [], connections: [] }
  }
}

interface ParsedScanReport {
  findings: Array<{ severity: string; agentName?: string; file?: string; line?: number; description: string; matchedText?: string; location?: string; regexValidation?: string; evidence?: string; recommendation?: string }>
  llmSummary: string | null
  llmRiskLevel: string | null
}

function parseScanReport(template: ReviewTemplate): ParsedScanReport {
  const report = template.autoScanReport || template.reviewNotes
  if (!report) return { findings: [], llmSummary: null, llmRiskLevel: null }
  try {
    const parsed = JSON.parse(report)
    const findings: ParsedScanReport["findings"] = []
    let llmSummary: string | null = null
    let llmRiskLevel: string | null = null

    if (parsed.regex?.findings) {
      for (const f of parsed.regex.findings) findings.push({ ...f, source: "regex" })
    }
    if (parsed.llm) {
      llmSummary = parsed.llm.summary || null
      llmRiskLevel = parsed.llm.riskLevel || null
      if (parsed.llm.findings) {
        for (const f of parsed.llm.findings) findings.push({ ...f, source: "llm" })
      }
    }
    if (findings.length === 0) {
      if (parsed.autoScan && Array.isArray(parsed.autoScan)) {
        for (const f of parsed.autoScan) findings.push(f)
      }
      if (parsed.llmReview && Array.isArray(parsed.llmReview)) {
        for (const f of parsed.llmReview) findings.push({ ...f, source: "llm" })
      }
    }
    if (findings.length === 0 && Array.isArray(parsed.findings)) {
      return { findings: parsed.findings, llmSummary, llmRiskLevel }
    }
    if (findings.length === 0 && Array.isArray(parsed)) {
      return { findings: parsed, llmSummary, llmRiskLevel }
    }
    return { findings, llmSummary, llmRiskLevel }
  } catch {
    return { findings: [], llmSummary: null, llmRiskLevel: null }
  }
}

interface ReviewSkill {
  id: string
  name: string
  slug: string
  description: string
  category: string
  trustTier: string
  reviewStatus: string
  skillMd: string
  autoScanPassed: boolean | null
  autoScanReport: string | null
  sandboxPassed: boolean | null
  sandboxReport: string | null
  createdAt: string
  creator: CreatorInfo | null
}

type ReviewItem = ReviewTemplate | ReviewSkill

function relativeTime(date: string | Date): string {
  const now = Date.now()
  const then = new Date(date).getTime()
  const diff = now - then
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function ScanStatus({ passed }: { passed: boolean | null }) {
  if (passed === true) {
    return (
      <span className="inline-flex items-center gap-1">
        <CheckCircle2 className="w-3.5 h-3.5 text-[var(--ok)]" />
        <span className="text-[11px] text-[var(--ok)]">Pass</span>
      </span>
    )
  }
  if (passed === false) {
    return (
      <span className="inline-flex items-center gap-1">
        <XCircle className="w-3.5 h-3.5 text-[var(--err)]" />
        <span className="text-[11px] text-[var(--err)]">Fail</span>
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1">
      <Circle className="w-3.5 h-3.5 text-[var(--tx3)]" />
      <span className="text-[11px] text-[var(--tx3)]">Pending</span>
    </span>
  )
}

function isSkill(item: ReviewItem): item is ReviewSkill {
  return "skillMd" in item
}

function reviewQueueType(item: ReviewItem): "templates" | "skills" {
  return isSkill(item) ? "skills" : "templates"
}

function AgentAccordion({ agent }: { agent: SnapshotAgent }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border border-[var(--bd)] rounded-[6px] overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left bg-[var(--bg2)] hover:bg-[var(--bg3)] transition-colors cursor-pointer border-none"
      >
        {open ? <ChevronDown className="w-3 h-3 text-[var(--tx3)]" /> : <ChevronRight className="w-3 h-3 text-[var(--tx3)]" />}
        <span className="text-[11px] font-semibold text-[var(--tx)]">{agent.name}</span>
        <span className="text-[9px] uppercase text-[var(--tx3)] font-medium">{agent.role}</span>
        <span className="text-[9px] text-[var(--tx3)] ml-auto">{agent.model}</span>
      </button>
      {open && (
        <div className="p-3 space-y-3">
          {agent.soulMd && (
            <div>
              <label className="text-[10px] font-medium text-[var(--tx2)] mb-1 block">SOUL.md</label>
              <pre className="bg-[var(--bg2)] border border-[var(--bd)] rounded-[6px] p-2 text-[10px] font-mono whitespace-pre-wrap text-[var(--tx2)] max-h-[200px] overflow-y-auto">{agent.soulMd}</pre>
            </div>
          )}
          {agent.agentsMd && (
            <div>
              <label className="text-[10px] font-medium text-[var(--tx2)] mb-1 block">AGENTS.md</label>
              <pre className="bg-[var(--bg2)] border border-[var(--bd)] rounded-[6px] p-2 text-[10px] font-mono whitespace-pre-wrap text-[var(--tx2)] max-h-[200px] overflow-y-auto">{agent.agentsMd}</pre>
            </div>
          )}
          {agent.heartbeatMd && (
            <div>
              <label className="text-[10px] font-medium text-[var(--tx2)] mb-1 block">HEARTBEAT.md</label>
              <pre className="bg-[var(--bg2)] border border-[var(--bd)] rounded-[6px] p-2 text-[10px] font-mono whitespace-pre-wrap text-[var(--tx2)] max-h-[200px] overflow-y-auto">{agent.heartbeatMd}</pre>
            </div>
          )}
          {agent.skills && agent.skills.length > 0 && (
            <div>
              <label className="text-[10px] font-medium text-[var(--tx2)] mb-1 block">Skills ({agent.skills.length})</label>
              <div className="flex flex-wrap gap-1">
                {agent.skills.map(s => (
                  <span key={s.slug} className="text-[9px] px-[6px] py-[2px] rounded-[4px] bg-[var(--bg3)] text-[var(--tx2)]">{s.name}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function DetailPanel({ item, onClose, onApprove, onReject, onSandboxRerun, actionLoading, sandboxRerunLoading }: {
  item: ReviewItem
  onClose: () => void
  onApprove: () => void
  onReject: () => void
  onSandboxRerun?: () => void
  actionLoading: boolean
  sandboxRerunLoading?: boolean
}) {
  const isTemplate = !isSkill(item)
  const template = isTemplate ? (item as ReviewTemplate) : null
  const skill = isSkill(item) ? item : null

  const snapshot = template?.workspaceSnapshot ? parseSnapshot(template.workspaceSnapshot) : null
  const scanReport = template ? parseScanReport(template) : { findings: [], llmSummary: null, llmRiskLevel: null }

  return (
    <>
      <div className="fixed inset-0 bg-[rgba(0,0,0,0.15)] z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-[640px] max-w-[90vw] bg-[var(--bg)] border-l border-[var(--bd)] shadow-modal z-50 overflow-y-auto">
        <div className="p-5">
          <div className="flex items-start justify-between mb-4">
            <h2 className="text-[16px] font-semibold text-[var(--tx)]">{item.name}</h2>
            <button onClick={onClose} className="p-1 hover:bg-[var(--bg2)] rounded-md transition-colors cursor-pointer bg-transparent border-none" aria-label="Close panel">
              <X className="w-4 h-4 text-[var(--tx3)]" />
            </button>
          </div>

          {item.creator && (
            <div className="flex items-center gap-2 mb-3">
              {item.creator.avatarUrl ? (
                <img src={item.creator.avatarUrl} alt="" className="w-6 h-6 rounded-full" />
              ) : (
                <div className="w-6 h-6 rounded-full bg-[var(--bg3)] flex items-center justify-center text-[10px] font-semibold text-[var(--tx2)]">
                  {item.creator.displayName[0]?.toUpperCase()}
                </div>
              )}
              <span className="text-[12px] text-[var(--tx2)]">{item.creator.displayName}</span>
              {item.creator.user?.email && <span className="text-[10px] text-[var(--tx3)]">({item.creator.user.email})</span>}
            </div>
          )}

          <div className="flex items-center gap-2 mb-4">
            <span className="inline-flex items-center text-[10px] font-semibold tracking-[0.5px] uppercase py-[2px] px-2 rounded-[4px] leading-tight bg-[var(--bg3)] text-[var(--tx2)] border border-[var(--bd)]">{item.category}</span>
            <span className="inline-flex items-center text-[10px] font-semibold tracking-[0.5px] uppercase py-[2px] px-2 rounded-[4px] leading-tight bg-[var(--bg3)] text-[var(--tx2)] border border-[var(--bd)]">{item.trustTier}</span>
          </div>

          <p className="text-[12px] text-[var(--tx2)] mb-4">{item.description}</p>

          {/* Auto-Scan Results (both templates and skills) */}
          {template && (
            <div className="mb-4">
              <h3 className="text-[12px] font-semibold text-[var(--tx)] mb-2">Security Scan</h3>
              <div className="bg-[var(--bg2)] border border-[var(--bd)] rounded-[8px] p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <ScanStatus passed={template.autoScanPassed} />
                  {scanReport.llmRiskLevel && (
                    <span className={`text-[10px] ml-2 ${scanReport.llmRiskLevel === "safe" || scanReport.llmRiskLevel === "low" ? "text-[var(--ok)]" : scanReport.llmRiskLevel === "medium" ? "text-[var(--warn)]" : "text-[var(--err)]"}`}>
                      AI: {scanReport.llmRiskLevel}
                    </span>
                  )}
                </div>
                {scanReport.llmSummary && (
                  <p className="text-[11px] text-[var(--tx2)] mb-2 italic">{scanReport.llmSummary}</p>
                )}
                {scanReport.findings.length > 0 && (
                  <div className="space-y-1.5 mt-2">
                    {scanReport.findings.map((f, i) => (
                      <div key={i} className="text-[10px]">
                        <div className="flex items-start gap-2">
                          <span className={f.severity === "critical" ? "text-[var(--err)]" : f.severity === "warning" ? "text-[var(--warn)]" : "text-[var(--tx3)]"}>
                            {f.severity === "critical" ? <XCircle className="w-3 h-3 inline" /> : <Circle className="w-3 h-3 inline" />}
                          </span>
                          <span className="text-[var(--tx2)]">
                            <span className="font-semibold uppercase text-[9px]">{f.severity}</span>
                            {f.agentName && <span className="text-[var(--tx3)] ml-1">{f.agentName}</span>}
                            {f.file && <span className="text-[var(--tx3)] ml-1">{f.file}</span>}
                            {f.line ? <span className="text-[var(--tx3)] ml-1">L{f.line}</span> : null}
                            {f.location && <span className="text-[var(--tx3)] ml-1">{f.location}</span>}
                            {" - "}{f.description}
                          </span>
                        </div>
                        {f.regexValidation && (
                          <div className={`ml-5 mt-[2px] text-[9px] italic ${f.regexValidation.startsWith("FALSE POSITIVE") ? "text-[var(--ok)]" : "text-[var(--err)]"}`}>
                            AI: {f.regexValidation}
                          </div>
                        )}
                        {f.evidence && <div className="ml-5 mt-[2px] text-[9px] text-[var(--tx3)]">Evidence: {f.evidence}</div>}
                        {f.recommendation && <div className="ml-5 mt-[2px] text-[9px] text-[var(--tx3)]">Recommendation: {f.recommendation}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Template: Agent Content */}
          {template && snapshot && snapshot.agents.length > 0 && (
            <div className="mb-4">
              <h3 className="text-[12px] font-semibold text-[var(--tx)] mb-2">Agent Content ({snapshot.agents.length} agents)</h3>
              <div className="space-y-2">
                {snapshot.agents.map((agent, i) => (
                  <AgentAccordion key={i} agent={agent} />
                ))}
              </div>
            </div>
          )}

          {/* Template: Connections */}
          {template && snapshot && snapshot.connections.length > 0 && (
            <div className="mb-4">
              <h3 className="text-[12px] font-semibold text-[var(--tx)] mb-2">Connections</h3>
              <div className="space-y-1">
                {snapshot.connections.map((c, i) => (
                  <div key={i} className="text-[10px] text-[var(--tx2)]">
                    {c.sourceSlug || "?"} &rarr; {c.targetSlug || "?"} <span className="text-[var(--tx3)]">({c.condition})</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Template: Pricing & Metadata */}
          {template && (
            <div className="mb-4">
              <h3 className="text-[12px] font-semibold text-[var(--tx)] mb-2">Pricing & Metadata</h3>
              <div className="text-[11px] text-[var(--tx2)] space-y-1">
                <div>Price: {template.isFree ? "Free" : `$${template.price}`}</div>
                {template.estimatedMonthlyCost && <div>Est. monthly LLM cost: {template.estimatedMonthlyCost}</div>}
                {template.tags.length > 0 && <div>Tags: {template.tags.join(", ")}</div>}
                <div>Agents: {template.agentCount}</div>
              </div>
            </div>
          )}

          {/* Skill: SKILL.md */}
          {skill && skill.skillMd && (
            <div className="mb-4">
              <h3 className="text-[12px] font-semibold text-[var(--tx)] mb-2">SKILL.md</h3>
              <pre className="bg-[var(--bg2)] border border-[var(--bd)] rounded-[8px] p-3 text-[11px] font-mono overflow-x-auto max-h-[400px] overflow-y-auto whitespace-pre-wrap text-[var(--tx2)]">
                {skill.skillMd}
              </pre>
            </div>
          )}

          {/* Skill: Auto-Scan */}
          {skill && skill.autoScanReport && (
            <div className="mb-4">
              <h3 className="text-[12px] font-semibold text-[var(--tx)] mb-2">Auto-Scan Results</h3>
              <div className="bg-[var(--bg2)] border border-[var(--bd)] rounded-[8px] p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <ScanStatus passed={skill.autoScanPassed} />
                </div>
                <pre className="text-[10px] font-mono text-[var(--tx2)] whitespace-pre-wrap">{skill.autoScanReport}</pre>
              </div>
            </div>
          )}

          {/* Skill: Sandbox (always show for skills — pending or graded) */}
          {skill && (
            <SandboxReportViewer
              passed={skill.sandboxPassed}
              reportRaw={skill.sandboxReport}
              onRerun={onSandboxRerun}
              rerunLoading={sandboxRerunLoading}
            />
          )}

          {/* Footer: Actions */}
          <div className="border-t border-[var(--bd)] pt-4 mt-4">
            <div className="flex gap-2">
              <Button variant="primary" loading={actionLoading} onClick={onApprove}>Approve</Button>
              <Button variant="danger" onClick={onReject}>Reject</Button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

export default function AdminReviewsPage() {
  const snackbar = useSnackbarOptional()
  const [activeTab, setActiveTab] = useState("templates")
  const [templates, setTemplates] = useState<ReviewTemplate[]>([])
  const [skills, setSkills] = useState<ReviewSkill[]>([])
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [selectedItem, setSelectedItem] = useState<ReviewItem | null>(null)
  const [rejectItem, setRejectItem] = useState<ReviewItem | null>(null)
  const [rejectReason, setRejectReason] = useState("")
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [sandboxRerunId, setSandboxRerunId] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    try {
      const [tplRes, skillRes] = await Promise.all([
        fetch("/api/admin/review-queue/templates"),
        fetch("/api/admin/review-queue/skills"),
      ])

      // Defense-in-depth: a 403 is unauthorized, not "nothing to review" (GH #127).
      if (tplRes.status === 403 || skillRes.status === 403) {
        setForbidden(true)
        return
      }

      // Batch G: non-403 failures → NetworkError, never a false-empty queue.
      if (!tplRes.ok || !skillRes.ok) {
        setLoadError(true)
        setTemplates([])
        setSkills([])
        return
      }

      const tplJson = await tplRes.json()
      const skillJson = await skillRes.json()
      setTemplates(tplJson.data ?? [])
      setSkills(skillJson.data ?? [])
    } catch (error) {
      console.error("Failed to fetch review queue:", error)
      setLoadError(true)
      setTemplates([])
      setSkills([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  async function handleApprove(type: "templates" | "skills", id: string) {
    setActionLoading(id)
    try {
      await mutateWithFeedback(
        async () => {
          const res = await fetch(`/api/admin/review-queue/${type}/${id}/approve`, {
            method: "POST",
          })
          if (!res.ok) {
            const body = await res.json().catch(() => ({})) as { error?: { code?: string; message?: string } }
            if (body?.error?.code === "SANDBOX_REQUIRED") {
              throw new Error(body.error.message || "Sandbox must pass before approve")
            }
            throw new Error(body?.error?.message || "Could not approve")
          }
          if (type === "templates") {
            setTemplates((prev) => prev.filter((t) => t.id !== id))
          } else {
            setSkills((prev) => prev.filter((s) => s.id !== id))
          }
          if (selectedItem?.id === id) setSelectedItem(null)
        },
        { message: "Approved", errorMessage: "Could not approve" },
        (opts) => snackbar?.show(opts),
      )
    } catch (error) {
      console.error("Approve failed:", error)
    } finally {
      setActionLoading(null)
    }
  }

  async function handleSandboxRerun(id: string) {
    setSandboxRerunId(id)
    try {
      await mutateWithFeedback(
        async () => {
          const res = await fetch(`/api/admin/review-queue/skills/${id}/sandbox-rerun`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ force: true }),
          })
          if (!res.ok) throw new Error("Could not re-run sandbox")
          await fetchData()
          const skillRes = await fetch("/api/admin/review-queue/skills")
          if (skillRes.ok) {
            const skillJson = await skillRes.json() as { data?: ReviewSkill[] }
            const refreshed = (skillJson.data ?? []).find((s) => s.id === id)
            if (refreshed) setSelectedItem(refreshed)
          }
        },
        { message: "Sandbox re-queued", errorMessage: "Could not re-run sandbox" },
        (opts) => snackbar?.show(opts),
      )
    } catch (error) {
      console.error("Sandbox re-run failed:", error)
    } finally {
      setSandboxRerunId(null)
    }
  }

  async function handleReject() {
    if (!rejectItem || !rejectReason.trim()) return
    const type = reviewQueueType(rejectItem)
    setActionLoading(rejectItem.id)
    try {
      await mutateWithFeedback(
        async () => {
          const res = await fetch(`/api/admin/review-queue/${type}/${rejectItem.id}/reject`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reason: rejectReason.trim() }),
          })
          if (!res.ok) throw new Error("Could not reject")
          if (type === "templates") {
            setTemplates((prev) => prev.filter((t) => t.id !== rejectItem.id))
          } else {
            setSkills((prev) => prev.filter((s) => s.id !== rejectItem.id))
          }
          setRejectItem(null)
          setRejectReason("")
          if (selectedItem?.id === rejectItem.id) setSelectedItem(null)
        },
        { message: "Rejected", errorMessage: "Could not reject" },
        (opts) => snackbar?.show(opts),
      )
    } catch (error) {
      console.error("Reject failed:", error)
    } finally {
      setActionLoading(null)
    }
  }

  const items: ReviewItem[] = activeTab === "templates" ? templates : skills
  const isSkillsTab = activeTab === "skills"

  const tabDefs = [
    { id: "templates", label: `Templates (${templates.length})` },
    { id: "skills", label: `Skills (${skills.length})` },
  ]

  if (forbidden) return <AdminAccessDenied />

  return (
    <div className="max-w-5xl mx-auto px-4 py-4">
      <h1 className="text-[16px] font-semibold mb-3 text-[var(--tx)]">Review Queue</h1>

      <Tabs
        tabs={tabDefs}
        activeTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab)
          // Batch G: detail closes on tab switch (type must not follow stale tab).
          setSelectedItem(null)
          setRejectItem(null)
          setRejectReason("")
        }}
      />

      {loading ? (
        <LoadingSkeleton variant="line" count={6} />
      ) : loadError ? (
        <NetworkError
          message="Failed to load the review queue. Check your connection and try again."
          onRetry={() => {
            void fetchData()
          }}
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<CheckCircle2 className="w-5 h-5" />}
          title="No items pending review"
          description="All submissions have been reviewed."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--bd)]">
                <th className="text-[11px] font-medium text-[var(--tx2)] text-left p-[6px]">Name</th>
                <th className="text-[11px] font-medium text-[var(--tx2)] text-left p-[6px]">Creator</th>
                <th className="text-[11px] font-medium text-[var(--tx2)] text-left p-[6px]">Submitted</th>
                <th className="text-[11px] font-medium text-[var(--tx2)] text-left p-[6px]">Auto-Scan</th>
                {isSkillsTab && (
                  <th className="text-[11px] font-medium text-[var(--tx2)] text-left p-[6px]">Sandbox</th>
                )}
                <th className="text-[11px] font-medium text-[var(--tx2)] text-right p-[6px]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const skill = isSkill(item) ? item : null
                return (
                  <tr key={item.id} className="border-b border-[var(--bd)]">
                    <td className="p-[6px]">
                      <button
                        onClick={() => setSelectedItem(item)}
                        className="text-[12px] font-medium text-[var(--tx)] hover:underline cursor-pointer bg-transparent border-none p-0 text-left"
                      >
                        {item.name}
                      </button>
                    </td>
                    <td className="p-[6px] text-[12px] text-[var(--tx2)]">
                      {item.creator?.displayName || "Unknown"}
                    </td>
                    <td className="p-[6px] text-[12px] text-[var(--tx3)]">
                      {relativeTime(item.createdAt)}
                    </td>
                    <td className="p-[6px]">
                      {skill ? (
                        <ScanStatus passed={skill.autoScanPassed} />
                      ) : (
                        <ScanStatus passed={(item as ReviewTemplate).autoScanPassed} />
                      )}
                    </td>
                    {isSkillsTab && (
                      <td className="p-[6px]">
                        {skill ? (
                          <ScanStatus passed={skill.sandboxPassed} />
                        ) : (
                          <span className="text-[var(--tx3)] text-[11px]">&mdash;</span>
                        )}
                      </td>
                    )}
                    <td className="p-[6px]">
                      <div className="flex gap-[4px] justify-end">
                        <Button
                          size="sm"
                          variant="primary"
                          loading={actionLoading === item.id}
                          onClick={() => handleApprove(reviewQueueType(item), item.id)}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setRejectItem(item)
                            setRejectReason("")
                          }}
                        >
                          Reject
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setSelectedItem(item)}
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Reject Modal */}
      <Modal
        open={!!rejectItem}
        onClose={() => {
          setRejectItem(null)
          setRejectReason("")
        }}
        title={`Reject ${rejectItem?.name || ""}`}
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setRejectItem(null)
                setRejectReason("")
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={!!actionLoading}
              disabled={!rejectReason.trim()}
              onClick={handleReject}
            >
              Reject
            </Button>
          </>
        }
      >
        <div>
          <label className="block text-[12px] font-medium text-[var(--tx)] mb-1">
            Reason <span className="text-[var(--err)]">*</span>
          </label>
          <Textarea
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Explain why this was rejected..."
            rows={4}
          />
        </div>
      </Modal>

      {/* Detail Side Panel */}
      {selectedItem && (
        <DetailPanel
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onApprove={() => handleApprove(reviewQueueType(selectedItem), selectedItem.id)}
          onReject={() => { setRejectItem(selectedItem); setRejectReason("") }}
          onSandboxRerun={
            isSkill(selectedItem)
              ? () => { void handleSandboxRerun(selectedItem.id) }
              : undefined
          }
          actionLoading={actionLoading === selectedItem.id}
          sandboxRerunLoading={sandboxRerunId === selectedItem.id}
        />
      )}
    </div>
  )
}
