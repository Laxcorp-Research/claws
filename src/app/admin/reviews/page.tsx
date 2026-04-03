"use client"

import { useState, useEffect, useCallback } from "react"
import { CheckCircle2, XCircle, Circle, X, Eye, ChevronDown, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs } from "@/components/ui/tabs"
import { Modal } from "@/components/ui/modal"
import { Textarea } from "@/components/ui/textarea"
import { EmptyState } from "@/components/ui/empty-state"
import { LoadingSkeleton } from "@/components/ui/loading-skeleton"

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

function parseScanFindings(template: ReviewTemplate): Array<{ severity: string; agentName?: string; file?: string; line?: number; description: string; matchedText?: string; location?: string }> {
  const report = template.autoScanReport || template.reviewNotes
  if (!report) return []
  try {
    const parsed = JSON.parse(report)
    if (Array.isArray(parsed.findings)) return parsed.findings
    if (parsed.autoScan && Array.isArray(parsed.autoScan)) return parsed.autoScan
    if (Array.isArray(parsed)) return parsed
    return []
  } catch {
    return []
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
  return 'skillMd' in item
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

function DetailPanel({ item, onClose, onApprove, onReject, actionLoading }: {
  item: ReviewItem
  onClose: () => void
  onApprove: () => void
  onReject: () => void
  actionLoading: boolean
}) {
  const isTemplate = !isSkill(item)
  const template = isTemplate ? (item as ReviewTemplate) : null
  const skill = isSkill(item) ? item : null

  const snapshot = template?.workspaceSnapshot ? parseSnapshot(template.workspaceSnapshot) : null
  const scanFindings = template ? parseScanFindings(template) : []

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
                  {template.autoScanPassed === true && scanFindings.length > 0 && (
                    <span className="text-[10px] text-[var(--warn)] ml-2">({scanFindings.length} warnings)</span>
                  )}
                </div>
                {scanFindings.length > 0 && (
                  <div className="space-y-1 mt-2">
                    {scanFindings.map((f, i) => (
                      <div key={i} className="flex items-start gap-2 text-[10px]">
                        <span className={f.severity === "critical" ? "text-[var(--err)]" : "text-[var(--warn)]"}>
                          {f.severity === "critical" ? <XCircle className="w-3 h-3 inline" /> : <Circle className="w-3 h-3 inline" />}
                        </span>
                        <span className="text-[var(--tx2)]">
                          <span className="font-semibold uppercase text-[9px]">{f.severity}</span>
                          {f.agentName && <span className="text-[var(--tx3)] ml-1">{f.agentName}</span>}
                          {f.file && <span className="text-[var(--tx3)] ml-1">{f.file}</span>}
                          {f.line && <span className="text-[var(--tx3)] ml-1">L{f.line}</span>}
                          {f.location && <span className="text-[var(--tx3)] ml-1">{f.location}</span>}
                          {" - "}{f.description}
                        </span>
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

          {/* Skill: Sandbox */}
          {skill && skill.sandboxReport && (
            <div className="mb-4">
              <h3 className="text-[12px] font-semibold text-[var(--tx)] mb-2">Sandbox Results</h3>
              <div className="bg-[var(--bg2)] border border-[var(--bd)] rounded-[8px] p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <ScanStatus passed={skill.sandboxPassed} />
                </div>
                <pre className="text-[10px] font-mono text-[var(--tx2)] whitespace-pre-wrap">{skill.sandboxReport}</pre>
              </div>
            </div>
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
  const [activeTab, setActiveTab] = useState("templates")
  const [templates, setTemplates] = useState<ReviewTemplate[]>([])
  const [skills, setSkills] = useState<ReviewSkill[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedItem, setSelectedItem] = useState<ReviewItem | null>(null)
  const [rejectItem, setRejectItem] = useState<ReviewItem | null>(null)
  const [rejectReason, setRejectReason] = useState("")
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [tplRes, skillRes] = await Promise.all([
        fetch("/api/admin/review-queue/templates"),
        fetch("/api/admin/review-queue/skills"),
      ])

      if (tplRes.ok) {
        const tplJson = await tplRes.json()
        setTemplates(tplJson.data ?? [])
      }
      if (skillRes.ok) {
        const skillJson = await skillRes.json()
        setSkills(skillJson.data ?? [])
      }
    } catch (error) {
      console.error("Failed to fetch review queue:", error)
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
      const res = await fetch(`/api/admin/review-queue/${type}/${id}/approve`, { method: "POST" })
      if (!res.ok) throw new Error("Failed")
      if (type === "templates") {
        setTemplates(prev => prev.filter(t => t.id !== id))
      } else {
        setSkills(prev => prev.filter(s => s.id !== id))
      }
      if (selectedItem?.id === id) setSelectedItem(null)
    } catch (error) {
      console.error("Approve failed:", error)
    } finally {
      setActionLoading(null)
    }
  }

  async function handleReject() {
    if (!rejectItem || !rejectReason.trim()) return
    const type = activeTab as "templates" | "skills"
    setActionLoading(rejectItem.id)
    try {
      const res = await fetch(`/api/admin/review-queue/${type}/${rejectItem.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: rejectReason.trim() }),
      })
      if (!res.ok) throw new Error("Failed")
      if (type === "templates") {
        setTemplates(prev => prev.filter(t => t.id !== rejectItem.id))
      } else {
        setSkills(prev => prev.filter(s => s.id !== rejectItem.id))
      }
      setRejectItem(null)
      setRejectReason("")
      if (selectedItem?.id === rejectItem.id) setSelectedItem(null)
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

  return (
    <div className="max-w-5xl mx-auto px-4 py-4">
      <h1 className="text-[16px] font-semibold mb-3 text-[var(--tx)]">Review Queue</h1>

      <Tabs tabs={tabDefs} activeTab={activeTab} onTabChange={setActiveTab} />

      {loading ? (
        <LoadingSkeleton variant="line" count={6} />
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
                          onClick={() => handleApprove(activeTab as "templates" | "skills", item.id)}
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
          onApprove={() => handleApprove(activeTab as "templates" | "skills", selectedItem.id)}
          onReject={() => { setRejectItem(selectedItem); setRejectReason("") }}
          actionLoading={actionLoading === selectedItem.id}
        />
      )}
    </div>
  )
}
