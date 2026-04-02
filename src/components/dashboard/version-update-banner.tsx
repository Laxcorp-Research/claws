"use client"

import { useState, useEffect } from "react"
import { ArrowUpCircle, ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AlertBanner } from "@/components/ui/alert-banner"

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
      <AlertBanner
        variant="error"
        icon={<ShieldAlert className="w-4 h-4" />}
        actions={<Button variant="danger" size="xs" loading={isUpdating} onClick={handleUpdate}>Update now</Button>}
      >
        <p className="font-medium">Security update available</p>
        <p className="mt-0.5 opacity-80">
          A security patch is available ({currentVer} &rarr; v{stableVer}). Your Claw will be automatically updated within 48 hours. Update now to apply immediately.
        </p>
        {updateError && <p className="text-[11px] text-[var(--err)] mt-1">{updateError}</p>}
      </AlertBanner>
    )
  }

  return (
    <AlertBanner
      variant="warning"
      icon={<ArrowUpCircle className="w-4 h-4" />}
      actions={<Button variant="primary" size="xs" loading={isUpdating} onClick={handleUpdate}>Update now</Button>}
    >
      <p className="font-medium">Update available</p>
      <p className="mt-0.5 opacity-80">
        A newer version of OpenClaw is available ({currentVer} &rarr; v{stableVer}). Update to get the latest improvements and security fixes.
      </p>
      {updateError && <p className="text-[11px] text-[var(--err)] mt-1">{updateError}</p>}
    </AlertBanner>
  )
}
