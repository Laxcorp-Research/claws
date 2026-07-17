"use client"

import { useState, useEffect, useCallback } from "react"
import { Flag } from "lucide-react"
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

interface EnrichedReport {
  id: string
  reporterId: string
  templateId: string | null
  skillId: string | null
  reviewId: string | null
  reason: string
  details: string | null
  resolved: boolean
  resolvedAt: string | null
  resolution: string | null
  createdAt: string
  itemName: string
  itemType: string
}

const REASON_LABELS: Record<string, string> = {
  MALICIOUS: "Malicious",
  MISLEADING: "Misleading",
  COPYRIGHT: "Copyright",
  SPAM: "Spam",
  INAPPROPRIATE: "Inappropriate",
  BROKEN: "Broken",
  NAME_CONFLICT: "Name Conflict",
}

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

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}

export default function AdminReportsPage() {
  const snackbar = useSnackbarOptional()
  const [activeTab, setActiveTab] = useState("open")
  const [openReports, setOpenReports] = useState<EnrichedReport[]>([])
  const [resolvedReports, setResolvedReports] = useState<EnrichedReport[]>([])
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [resolveItem, setResolveItem] = useState<EnrichedReport | null>(null)
  const [resolution, setResolution] = useState("")
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    try {
      const [openRes, resolvedRes] = await Promise.all([
        fetch("/api/admin/reports?resolved=false"),
        fetch("/api/admin/reports?resolved=true"),
      ])

      // Defense-in-depth: a 403 is unauthorized, not "no reports" (GH #127).
      if (openRes.status === 403 || resolvedRes.status === 403) {
        setForbidden(true)
        return
      }

      // Batch G: non-403 failures → NetworkError, never a false-empty queue.
      if (!openRes.ok || !resolvedRes.ok) {
        setLoadError(true)
        setOpenReports([])
        setResolvedReports([])
        return
      }

      const openJson = await openRes.json()
      const resolvedJson = await resolvedRes.json()
      setOpenReports(openJson.data ?? [])
      setResolvedReports(resolvedJson.data ?? [])
    } catch (error) {
      console.error("Failed to fetch reports:", error)
      setLoadError(true)
      setOpenReports([])
      setResolvedReports([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  async function handleResolve() {
    if (!resolveItem || !resolution.trim()) return
    setActionLoading(resolveItem.id)
    try {
      await mutateWithFeedback(
        async () => {
          const res = await fetch(`/api/admin/reports/${resolveItem.id}/resolve`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ resolution: resolution.trim() }),
          })
          if (!res.ok) throw new Error("Could not resolve report")
          setOpenReports((prev) => prev.filter((r) => r.id !== resolveItem.id))
          const resolvedReport = {
            ...resolveItem,
            resolved: true,
            resolution: resolution.trim(),
            resolvedAt: new Date().toISOString(),
          }
          setResolvedReports((prev) => [resolvedReport, ...prev])
          setResolveItem(null)
          setResolution("")
        },
        { message: "Report resolved", errorMessage: "Could not resolve report" },
        (opts) => snackbar?.show(opts),
      )
    } catch (error) {
      console.error("Resolve failed:", error)
    } finally {
      setActionLoading(null)
    }
  }

  const reports = activeTab === "open" ? openReports : resolvedReports
  const isResolved = activeTab === "resolved"

  const tabDefs = [
    { id: "open", label: `Open (${openReports.length})` },
    { id: "resolved", label: `Resolved (${resolvedReports.length})` },
  ]

  if (forbidden) return <AdminAccessDenied />

  return (
    <div className="max-w-5xl mx-auto px-4 py-4">
      <h1 className="text-[16px] font-semibold mb-3 text-[var(--tx)]">Reports</h1>

      <Tabs tabs={tabDefs} activeTab={activeTab} onTabChange={setActiveTab} />

      {loading ? (
        <LoadingSkeleton variant="line" count={6} />
      ) : loadError ? (
        <NetworkError
          message="Failed to load reports. Check your connection and try again."
          onRetry={() => {
            void fetchData()
          }}
        />
      ) : reports.length === 0 ? (
        <EmptyState
          icon={<Flag className="w-5 h-5" />}
          title={isResolved ? "No resolved reports" : "No open reports"}
          description={isResolved ? "No reports have been resolved yet." : "No user reports to review."}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--bd)]">
                <th className="text-[11px] font-medium text-[var(--tx2)] text-left p-[6px]">Item</th>
                <th className="text-[11px] font-medium text-[var(--tx2)] text-left p-[6px]">Type</th>
                <th className="text-[11px] font-medium text-[var(--tx2)] text-left p-[6px]">Reason</th>
                <th className="text-[11px] font-medium text-[var(--tx2)] text-left p-[6px]">Filed</th>
                <th className="text-[11px] font-medium text-[var(--tx2)] text-right p-[6px]">
                  {isResolved ? "Resolution" : "Actions"}
                </th>
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => (
                <tr key={report.id} className="border-b border-[var(--bd)]">
                  <td className="p-[6px] text-[12px] font-medium text-[var(--tx)]">
                    {report.itemName}
                  </td>
                  <td className="p-[6px] text-[12px] text-[var(--tx2)]">
                    {capitalize(report.itemType)}
                  </td>
                  <td className="p-[6px]">
                    <span className="inline-flex items-center text-[10px] font-semibold tracking-[0.5px] uppercase py-[2px] px-2 rounded-[4px] leading-tight bg-[var(--bg3)] text-[var(--tx2)] border border-[var(--bd)]">
                      {REASON_LABELS[report.reason] || report.reason}
                    </span>
                  </td>
                  <td className="p-[6px] text-[12px] text-[var(--tx3)]">
                    {relativeTime(report.createdAt)}
                  </td>
                  <td className="p-[6px] text-right">
                    {isResolved ? (
                      <span className="text-[11px] text-[var(--tx3)]">
                        {report.resolution || "Resolved"}
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setResolveItem(report)
                          setResolution("")
                        }}
                      >
                        Resolve
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Resolve Modal */}
      <Modal
        open={!!resolveItem}
        onClose={() => {
          setResolveItem(null)
          setResolution("")
        }}
        title="Resolve Report"
        description={resolveItem ? `${resolveItem.itemName} - ${REASON_LABELS[resolveItem.reason] || resolveItem.reason}` : undefined}
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => {
                setResolveItem(null)
                setResolution("")
              }}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={!!actionLoading}
              disabled={!resolution.trim()}
              onClick={handleResolve}
            >
              Resolve
            </Button>
          </>
        }
      >
        <div>
          {resolveItem?.details && (
            <div className="mb-3 bg-[var(--bg2)] border border-[var(--bd)] rounded-[8px] p-3">
              <p className="text-[11px] font-medium text-[var(--tx)] mb-1">Reporter details</p>
              <p className="text-[12px] text-[var(--tx2)]">{resolveItem.details}</p>
            </div>
          )}
          <label className="block text-[12px] font-medium text-[var(--tx)] mb-1">
            Resolution Notes <span className="text-[var(--err)]">*</span>
          </label>
          <Textarea
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            placeholder="Describe the action taken..."
            rows={4}
          />
        </div>
      </Modal>
    </div>
  )
}
