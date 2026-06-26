"use client"

import { useState, useEffect, useCallback } from "react"
import { Package, Pencil } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { EmptyState } from "@/components/ui/empty-state"
import { LoadingSkeleton } from "@/components/ui/loading-skeleton"
import { ConfirmDialog } from "@/components/ui/confirm-dialog"
import { AdminAccessDenied } from "@/components/admin/admin-access-denied"
import { compareOpenClawVersions } from "@/lib/openclaw/version-order"

interface VersionItem {
  id: string
  version: string
  isStable: boolean
  isLatest: boolean
  isSecurityPatch: boolean
  dockerImage: string
  releaseNotes: string | null
  breakingChanges: string | null
  releasedAt: string
  stableAt: string | null
  deploymentCount: number
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

export default function AdminVersionsPage() {
  const [versions, setVersions] = useState<VersionItem[]>([])
  const [loading, setLoading] = useState(true)
  const [forbidden, setForbidden] = useState(false)
  const [showAddModal, setShowAddModal] = useState(false)
  const [addForm, setAddForm] = useState({
    version: "",
    dockerImage: "",
    releaseNotes: "",
    breakingChanges: "",
    isSecurityPatch: false,
  })
  const [addLoading, setAddLoading] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [forceUpdateTarget, setForceUpdateTarget] = useState<VersionItem | null>(null)
  const [forceUpdateLoading, setForceUpdateLoading] = useState(false)
  const [forceUpdateResult, setForceUpdateResult] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [editTarget, setEditTarget] = useState<VersionItem | null>(null)
  const [editForm, setEditForm] = useState({
    version: "",
    dockerImage: "",
    releaseNotes: "",
    breakingChanges: "",
    isSecurityPatch: false,
    isStable: false,
  })
  const [editLoading, setEditLoading] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const fetchVersions = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/versions")
      // Defense-in-depth: a 403 means unauthorized, NOT an empty list. Branch
      // on the status (wire code is FORBIDDEN) so it never falls through to
      // the "No versions registered" empty state (GH #127).
      if (res.status === 403) {
        setForbidden(true)
        return
      }
      if (res.ok) {
        const json = await res.json()
        setVersions(json.data ?? [])
      }
    } catch (error) {
      console.error("Failed to fetch versions:", error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchVersions()
  }, [fetchVersions])

  async function handleAddVersion() {
    if (!addForm.version.trim() || !addForm.dockerImage.trim()) return
    setAddLoading(true)
    setAddError(null)
    try {
      const res = await fetch("/api/admin/versions/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: addForm.version.trim(),
          dockerImage: addForm.dockerImage.trim(),
          releaseNotes: addForm.releaseNotes.trim() || null,
          breakingChanges: addForm.breakingChanges.trim() || null,
          isSecurityPatch: addForm.isSecurityPatch,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error?.message || "Failed to create version")
      setShowAddModal(false)
      setAddForm({ version: "", dockerImage: "", releaseNotes: "", breakingChanges: "", isSecurityPatch: false })
      fetchVersions()
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "Failed to create version")
    } finally {
      setAddLoading(false)
    }
  }

  async function handlePromote(id: string) {
    setActionLoading(id)
    try {
      const res = await fetch(`/api/admin/versions/${id}/promote`, { method: "POST" })
      if (!res.ok) throw new Error("Failed")
      fetchVersions()
    } catch (error) {
      console.error("Promote failed:", error)
    } finally {
      setActionLoading(null)
    }
  }

  async function handleForceUpdate() {
    if (!forceUpdateTarget) return
    setForceUpdateLoading(true)
    try {
      const res = await fetch(`/api/admin/versions/${forceUpdateTarget.id}/force-update`, { method: "POST" })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error?.message || "Failed")
      setForceUpdateResult(json.data?.message || "Force update complete")
      setForceUpdateTarget(null)
      fetchVersions()
    } catch (error) {
      console.error("Force update failed:", error)
    } finally {
      setForceUpdateLoading(false)
    }
  }

  function openEdit(v: VersionItem) {
    setEditTarget(v)
    setEditForm({
      version: v.version,
      dockerImage: v.dockerImage,
      releaseNotes: v.releaseNotes || "",
      breakingChanges: v.breakingChanges || "",
      isSecurityPatch: v.isSecurityPatch,
      isStable: v.isStable,
    })
    setEditError(null)
  }

  async function handleEditVersion() {
    if (!editTarget || !editForm.version.trim() || !editForm.dockerImage.trim()) return
    setEditLoading(true)
    setEditError(null)
    try {
      const res = await fetch(`/api/admin/versions/${editTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          version: editForm.version.trim(),
          dockerImage: editForm.dockerImage.trim(),
          releaseNotes: editForm.releaseNotes.trim() || null,
          breakingChanges: editForm.breakingChanges.trim() || null,
          isSecurityPatch: editForm.isSecurityPatch,
          isStable: editForm.isStable,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error?.message || "Failed to update version")
      setEditTarget(null)
      fetchVersions()
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to update version")
    } finally {
      setEditLoading(false)
    }
  }

  if (forbidden) return <AdminAccessDenied />

  // GH #5: derive "Latest" from data instead of the stored isLatest flag, which
  // drifts on prod (the seed sets it on v2.5.0 and the stable/promote path never
  // updates it). Latest != Stable: the highest version gets "Latest"; the
  // isStable row gets "Stable"; they can differ. (deployer.resolveDeployImage
  // reads isStable, never isLatest.)
  //
  // Ordering is by VERSION (compareOpenClawVersions), not releasedAt: a -N
  // overlay hotfix rebuilt after a higher base (e.g. 2026.5.22-4 rebuilt after
  // 2026.6.6) gets a later releasedAt but is NOT the latest version — the
  // version comparator ranks it correctly. Shared with the version-update
  // banner / per-workspace update guard so "newest" means the same thing
  // everywhere.
  const latestVersionId = versions.length
    ? versions.reduce((newest, v) =>
        compareOpenClawVersions(v.version, newest.version) > 0 ? v : newest,
      ).id
    : null

  return (
    <div className="max-w-5xl mx-auto px-4 py-4">
      <div className="flex items-center justify-between mb-3">
        <h1 className="text-[16px] font-semibold text-[var(--tx)]">OpenClaw Versions</h1>
        <Button size="default" variant="primary" onClick={() => setShowAddModal(true)}>
          + Add Version
        </Button>
      </div>

      {forceUpdateResult && (
        <div className="bg-[#dcfce7] border border-[#bbf7d0] rounded-[8px] p-[10px_14px] text-[12px] text-[#166534] mb-3 flex items-center justify-between">
          <span>{forceUpdateResult}</span>
          <button
            onClick={() => setForceUpdateResult(null)}
            className="text-[11px] text-[#166534] underline cursor-pointer bg-transparent border-none"
          >
            Dismiss
          </button>
        </div>
      )}

      {loading ? (
        <LoadingSkeleton variant="card" count={3} />
      ) : versions.length === 0 ? (
        <EmptyState
          icon={<Package className="w-5 h-5" />}
          title="No versions registered"
          description="Add your first OpenClaw version to get started."
        />
      ) : (
        <div>
          {versions.map((v) => (
            <div
              key={v.id}
              className="border border-[var(--bd)] rounded-[12px] p-[14px] mb-[10px] cursor-pointer hover:border-[var(--tx3)] transition-colors"
              onClick={() => openEdit(v)}
            >
              <div className="flex items-center justify-between mb-[6px]">
                <div className="flex items-center gap-[8px] flex-wrap">
                  <span className="text-[15px] font-semibold text-[var(--tx)]">v{v.version}</span>
                  {v.isStable && (
                    <span className="bg-[#dcfce7] text-[#166534] text-[10px] font-medium px-[6px] py-[1px] rounded-full">
                      Stable
                    </span>
                  )}
                  {v.id === latestVersionId && (
                    <span className="bg-[#dbeafe] text-[#1e40af] text-[10px] font-medium px-[6px] py-[1px] rounded-full">
                      Latest
                    </span>
                  )}
                  {v.isSecurityPatch && (
                    <span className="bg-[#fef2f2] text-[#991b1b] text-[10px] font-medium px-[6px] py-[1px] rounded-full">
                      Security Patch
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-[4px]">
                  <button
                    className="p-[4px] rounded-[6px] text-[var(--tx3)] hover:text-[var(--tx)] hover:bg-[var(--bg2)] transition-colors"
                    onClick={(e) => { e.stopPropagation(); openEdit(v) }}
                    title="Edit version"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  {!v.isStable && (
                    <Button
                      size="sm"
                      variant="primary"
                      loading={actionLoading === v.id}
                      onClick={(e) => { e.stopPropagation(); handlePromote(v.id) }}
                    >
                      Promote to Stable
                    </Button>
                  )}
                  {v.isStable && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-[var(--err)] border-[var(--err)] hover:bg-[var(--errbg)]"
                      onClick={(e) => { e.stopPropagation(); setForceUpdateTarget(v) }}
                    >
                      Force Update All
                    </Button>
                  )}
                </div>
              </div>

              <div className="text-[12px] text-[var(--tx2)] mb-[4px]">
                Released {relativeTime(v.releasedAt)} &middot; {v.deploymentCount} active deployment{v.deploymentCount !== 1 ? "s" : ""}
              </div>

              {v.releaseNotes && (
                <div className="text-[12px] text-[var(--tx3)] mb-[4px] line-clamp-2">
                  {v.releaseNotes}
                </div>
              )}

              <div className="text-[11px] text-[var(--tx3)] font-mono">
                {v.dockerImage}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Version Modal */}
      <Modal
        open={showAddModal}
        onClose={() => {
          setShowAddModal(false)
          setAddError(null)
        }}
        title="Register New Version"
        footer={
          <>
            <Button variant="outline" onClick={() => { setShowAddModal(false); setAddError(null) }}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={addLoading}
              disabled={!addForm.version.trim() || !addForm.dockerImage.trim()}
              onClick={handleAddVersion}
            >
              Add Version
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {addError && (
            <div className="text-[11px] text-[var(--err)] bg-[var(--errbg)] rounded-[6px] p-2">
              {addError}
            </div>
          )}
          <div>
            <label className="block text-[12px] font-medium text-[var(--tx)] mb-1">
              Version <span className="text-[var(--err)]">*</span>
            </label>
            <Input
              placeholder="e.g., 0.2.0"
              value={addForm.version}
              onChange={(e) => setAddForm(prev => ({ ...prev, version: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[var(--tx)] mb-1">
              Docker Image <span className="text-[var(--err)]">*</span>
            </label>
            <Input
              placeholder="ghcr.io/laxcorp-research/openclaw-runtime:0.2.0"
              className="font-mono"
              value={addForm.dockerImage}
              onChange={(e) => setAddForm(prev => ({ ...prev, dockerImage: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[var(--tx)] mb-1">Release Notes</label>
            <Textarea
              placeholder="What's new in this version..."
              rows={3}
              value={addForm.releaseNotes}
              onChange={(e) => setAddForm(prev => ({ ...prev, releaseNotes: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[var(--tx)] mb-1">Breaking Changes</label>
            <Textarea
              placeholder="Any breaking changes..."
              rows={2}
              value={addForm.breakingChanges}
              onChange={(e) => setAddForm(prev => ({ ...prev, breakingChanges: e.target.value }))}
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={addForm.isSecurityPatch}
              onChange={(e) => setAddForm(prev => ({ ...prev, isSecurityPatch: e.target.checked }))}
              className="w-3.5 h-3.5 rounded border-[var(--bd)] accent-[var(--tx)]"
            />
            <span className="text-[12px] text-[var(--tx2)]">This is a security patch</span>
          </label>
        </div>
      </Modal>

      {/* Edit Version Modal */}
      <Modal
        open={!!editTarget}
        onClose={() => { setEditTarget(null); setEditError(null) }}
        title={`Edit v${editTarget?.version || ""}`}
        footer={
          <>
            <Button variant="outline" onClick={() => { setEditTarget(null); setEditError(null) }}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={editLoading}
              disabled={!editForm.version.trim() || !editForm.dockerImage.trim()}
              onClick={handleEditVersion}
            >
              Save Changes
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {editError && (
            <div className="text-[11px] text-[var(--err)] bg-[var(--errbg)] rounded-[6px] p-2">
              {editError}
            </div>
          )}
          <div>
            <label className="block text-[12px] font-medium text-[var(--tx)] mb-1">
              Version <span className="text-[var(--err)]">*</span>
            </label>
            <Input
              value={editForm.version}
              onChange={(e) => setEditForm(prev => ({ ...prev, version: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[var(--tx)] mb-1">
              Docker Image <span className="text-[var(--err)]">*</span>
            </label>
            <Input
              className="font-mono"
              value={editForm.dockerImage}
              onChange={(e) => setEditForm(prev => ({ ...prev, dockerImage: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[var(--tx)] mb-1">Release Notes</label>
            <Textarea
              rows={3}
              value={editForm.releaseNotes}
              onChange={(e) => setEditForm(prev => ({ ...prev, releaseNotes: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-[12px] font-medium text-[var(--tx)] mb-1">Breaking Changes</label>
            <Textarea
              rows={2}
              value={editForm.breakingChanges}
              onChange={(e) => setEditForm(prev => ({ ...prev, breakingChanges: e.target.value }))}
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={editForm.isStable}
              onChange={(e) => setEditForm(prev => ({ ...prev, isStable: e.target.checked }))}
              className="w-3.5 h-3.5 rounded border-[var(--bd)] accent-[var(--tx)]"
            />
            <span className="text-[12px] text-[var(--tx2)]">Stable</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={editForm.isSecurityPatch}
              onChange={(e) => setEditForm(prev => ({ ...prev, isSecurityPatch: e.target.checked }))}
              className="w-3.5 h-3.5 rounded border-[var(--bd)] accent-[var(--tx)]"
            />
            <span className="text-[12px] text-[var(--tx2)]">Security patch</span>
          </label>
        </div>
      </Modal>

      {/* Force Update Confirm Dialog */}
      <ConfirmDialog
        open={!!forceUpdateTarget}
        onClose={() => setForceUpdateTarget(null)}
        onConfirm={handleForceUpdate}
        title="Force Update All Deployments"
        description={`Queue all deployments to move to v${forceUpdateTarget?.version || ""} on next redeploy`}
        warningText={`This re-points ALL deployments to v${forceUpdateTarget?.version || ""}; it applies to each Claw on its next redeploy. Containers are NOT restarted now and nothing goes offline. Users will be emailed that the update is scheduled.`}
        confirmLabel="Force Update All"
        variant="danger"
        loading={forceUpdateLoading}
      />
    </div>
  )
}
