"use client"

import { useState, useEffect } from "react"
import { ArrowUpCircle, ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AlertBanner } from "@/components/ui/alert-banner"
import { isNewerVersion, extractVersionFromImage } from "@/lib/openclaw/version-order"

interface VersionUpdateBannerProps {
  workspaceId: string
  currentImage: string
  onUpdated: () => void
}

interface StableVersionInfo {
  version: string
  dockerImage: string
  isSecurityPatch: boolean
  releaseNotes: string | null
}

export function VersionUpdateBanner({ workspaceId, currentImage, onUpdated }: VersionUpdateBannerProps) {
  const [stableVersion, setStableVersion] = useState<StableVersionInfo | null>(null)
  const [isUpdating, setIsUpdating] = useState(false)
  const [updateError, setUpdateError] = useState<string | null>(null)
  const [updated, setUpdated] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/versions/stable')
      .then(res => res.json())
      .then(json => {
        if (!cancelled && json.success && json.data) {
          setStableVersion(json.data)
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  if (!stableVersion) return null

  const currentVer = extractVersionFromImage(currentImage)
  const stableVer = stableVersion.version
  const isSecurity = stableVersion.isSecurityPatch

  // Only prompt when the stable row is genuinely NEWER than the deployed image.
  // (Was: `stableVersion.dockerImage === currentImage` — string inequality,
  // which fired even when stable was OLDER, e.g. a -3 Claw shown "update to -2".
  // isNewerVersion is fail-safe: an unparseable/unregistered image -> no prompt.)
  if (!isNewerVersion(stableVer, currentVer)) return null

  if (updated) {
    return (
      <AlertBanner variant="info" icon={<ArrowUpCircle className="w-4 h-4" />}>
        <p className="font-medium">Update queued</p>
        <p className="mt-0.5 opacity-80">
          v{stableVer} will be applied the next time your Claw redeploys. Your Claw has not been updated yet.
        </p>
      </AlertBanner>
    )
  }

  async function handleUpdate() {
    setIsUpdating(true)
    setUpdateError(null)
    try {
      const res = await fetch(`/api/workspaces/${workspaceId}/update-version`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error?.message || 'Update failed')
      setUpdated(true)
      onUpdated()
    } catch (err) {
      setUpdateError(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setIsUpdating(false)
    }
  }

  if (isSecurity) {
    return (
      <AlertBanner
        variant="error"
        icon={<ShieldAlert className="w-4 h-4" />}
        actions={<Button variant="danger" size="xs" loading={isUpdating} onClick={handleUpdate}>Queue update</Button>}
      >
        <p className="font-medium">Security update available</p>
        <p className="mt-0.5 opacity-80">
          A security patch (v{stableVer}) is available. Your Claw is still running {currentVer} and has not been updated yet &mdash; queue it and v{stableVer} applies on the next redeploy. Redeploy your Claw to apply it sooner.
        </p>
        {updateError && <p className="text-[11px] text-[var(--err)] mt-1">{updateError}</p>}
      </AlertBanner>
    )
  }

  return (
    <AlertBanner
      variant="warning"
      icon={<ArrowUpCircle className="w-4 h-4" />}
      actions={<Button variant="primary" size="xs" loading={isUpdating} onClick={handleUpdate}>Queue update</Button>}
    >
      <p className="font-medium">Update available</p>
      <p className="mt-0.5 opacity-80">
        A newer version (v{stableVer}) is available. Your Claw is running {currentVer} &mdash; queue it and v{stableVer} applies on the next redeploy.
      </p>
      {updateError && <p className="text-[11px] text-[var(--err)] mt-1">{updateError}</p>}
    </AlertBanner>
  )
}
