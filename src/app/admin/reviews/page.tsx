"use client"

import { useState, useEffect, useCallback } from "react"
import { CheckCircle2, XCircle, Circle, X, Eye } from "lucide-react"
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
                        <span className="text-[var(--tx3)] text-[11px]">&mdash;</span>
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
        <>
          <div
            className="fixed inset-0 bg-[rgba(0,0,0,0.15)] z-40"
            onClick={() => setSelectedItem(null)}
          />
          <div className="fixed right-0 top-0 h-full w-[420px] bg-[var(--bg)] border-l border-[var(--bd)] shadow-modal z-50 overflow-y-auto">
            <div className="p-4">
              <div className="flex items-start justify-between mb-4">
                <h2 className="text-[15px] font-semibold text-[var(--tx)]">{selectedItem.name}</h2>
                <button
                  onClick={() => setSelectedItem(null)}
                  className="p-1 hover:bg-[var(--bg2)] rounded-md transition-colors cursor-pointer bg-transparent border-none"
                  aria-label="Close panel"
                >
                  <X className="w-4 h-4 text-[var(--tx3)]" />
                </button>
              </div>

              {selectedItem.creator && (
                <div className="flex items-center gap-2 mb-3">
                  {selectedItem.creator.avatarUrl ? (
                    <img
                      src={selectedItem.creator.avatarUrl}
                      alt=""
                      className="w-6 h-6 rounded-full"
                    />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-[var(--bg3)] flex items-center justify-center text-[10px] font-semibold text-[var(--tx2)]">
                      {selectedItem.creator.displayName[0]?.toUpperCase()}
                    </div>
                  )}
                  <span className="text-[12px] text-[var(--tx2)]">{selectedItem.creator.displayName}</span>
                </div>
              )}

              <div className="flex items-center gap-2 mb-3">
                <span
                  className="inline-flex items-center text-[10px] font-semibold tracking-[0.5px] uppercase py-[2px] px-2 rounded-[4px] leading-tight bg-[var(--bg3)] text-[var(--tx2)] border border-[var(--bd)]"
                >
                  {selectedItem.category}
                </span>
                <span
                  className="inline-flex items-center text-[10px] font-semibold tracking-[0.5px] uppercase py-[2px] px-2 rounded-[4px] leading-tight bg-[var(--bg3)] text-[var(--tx2)] border border-[var(--bd)]"
                >
                  {selectedItem.trustTier}
                </span>
              </div>

              <p className="text-[13px] text-[var(--tx2)] mb-4">{selectedItem.description}</p>

              {isSkill(selectedItem) && selectedItem.skillMd && (
                <div className="mb-4">
                  <h3 className="text-[13px] font-semibold text-[var(--tx)] mb-2">SKILL.md Preview</h3>
                  <pre className="bg-[var(--bg2)] border border-[var(--bd)] rounded-[8px] p-3 text-[12px] font-mono overflow-x-auto max-h-[300px] overflow-y-auto whitespace-pre-wrap text-[var(--tx2)]">
                    {selectedItem.skillMd}
                  </pre>
                </div>
              )}

              {isSkill(selectedItem) && selectedItem.autoScanReport && (
                <div className="mb-4">
                  <h3 className="text-[13px] font-semibold text-[var(--tx)] mb-2">Auto-Scan Results</h3>
                  <div className="bg-[var(--bg2)] border border-[var(--bd)] rounded-[8px] p-3">
                    <div className="flex items-center gap-1.5 mb-2">
                      <ScanStatus passed={selectedItem.autoScanPassed} />
                    </div>
                    <pre className="text-[11px] font-mono text-[var(--tx2)] whitespace-pre-wrap">
                      {selectedItem.autoScanReport}
                    </pre>
                  </div>
                </div>
              )}

              {isSkill(selectedItem) && selectedItem.sandboxReport && (
                <div className="mb-4">
                  <h3 className="text-[13px] font-semibold text-[var(--tx)] mb-2">Sandbox Results</h3>
                  <div className="bg-[var(--bg2)] border border-[var(--bd)] rounded-[8px] p-3">
                    <div className="flex items-center gap-1.5 mb-2">
                      <ScanStatus passed={selectedItem.sandboxPassed} />
                    </div>
                    <pre className="text-[11px] font-mono text-[var(--tx2)] whitespace-pre-wrap">
                      {selectedItem.sandboxReport}
                    </pre>
                  </div>
                </div>
              )}

              <div className="border-t border-[var(--bd)] pt-4 mt-4">
                <div className="flex gap-2">
                  <Button
                    variant="primary"
                    loading={actionLoading === selectedItem.id}
                    onClick={() => handleApprove(activeTab as "templates" | "skills", selectedItem.id)}
                  >
                    Approve
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => {
                      setRejectItem(selectedItem)
                      setRejectReason("")
                    }}
                  >
                    Reject
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
