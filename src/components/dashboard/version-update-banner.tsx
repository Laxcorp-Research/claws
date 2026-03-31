"use client"

import { useState, useEffect } from "react"
import { ArrowUpCircle, ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"

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

function extractVersion(image: string): string {
  const parts = image.split(':')
  return parts[parts.length - 1] || 'unknown'
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
  if (stableVersion.dockerImage === currentImage) return null
  if (updated) return null

  const currentVer = extractVersion(currentImage)
  const stableVer = stableVersion.version
  const isSecurity = stableVersion.isSecurityPatch

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
      <div className="bg-[var(--errbg)] border border-[var(--err)] rounded-[8px] p-[12px_14px] flex items-start gap-[8px] mb-[14px]" role="alert">
        <ShieldAlert className="w-4 h-4 text-[var(--err)] flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-semibold text-[#991b1b]">Security update available</p>
          <p className="text-[12px] text-[#991b1b] mt-0.5">
            A security patch is available ({currentVer} &rarr; v{stableVer}). Your Claw will be automatically updated within 48 hours. Update now to apply immediately.
          </p>
          {updateError && <p className="text-[11px] text-[var(--err)] mt-1">{updateError}</p>}
        </div>
        <Button size="sm" variant="danger" loading={isUpdating} onClick={handleUpdate}>
          Update now
        </Button>
      </div>
    )
  }

  return (
    <div className="bg-[var(--warnbg)] border border-[var(--warn)] rounded-[8px] p-[12px_14px] flex items-start gap-[8px] mb-[14px]" role="status">
      <ArrowUpCircle className="w-4 h-4 text-[var(--warn)] flex-shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-semibold text-[#92400e]">Update available</p>
        <p className="text-[12px] text-[#92400e] mt-0.5">
          A newer version of OpenClaw is available ({currentVer} &rarr; v{stableVer}). Update to get the latest improvements and security fixes.
        </p>
        {updateError && <p className="text-[11px] text-[var(--err)] mt-1">{updateError}</p>}
      </div>
      <Button size="sm" variant="primary" loading={isUpdating} onClick={handleUpdate}>
        Update now
      </Button>
    </div>
  )
}
