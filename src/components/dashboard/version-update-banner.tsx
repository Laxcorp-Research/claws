"use client"

import { useEffect, useState } from "react"
import { ArrowUpCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AlertBanner } from "@/components/ui/alert-banner"
import { isNewerVersion, extractVersionFromImage } from "@/lib/openclaw/version-order"

interface VersionUpdateBannerProps {
  currentImage: string
  onRedeploy: () => void
  showRedeployAction?: boolean
}

interface StableVersionInfo {
  version: string
  dockerImage: string
  releaseNotes: string | null
}

export function VersionUpdateBanner({ currentImage, onRedeploy, showRedeployAction = true }: VersionUpdateBannerProps) {
  const [stableVersion, setStableVersion] = useState<StableVersionInfo | null>(null)

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

  // Only prompt when the stable row is genuinely NEWER than the deployed image.
  // (Was: `stableVersion.dockerImage === currentImage` - string inequality,
  // which fired even when stable was OLDER, e.g. a -3 Claw shown "update to -2".
  // isNewerVersion is fail-safe: an unparseable/unregistered image -> no prompt.)
  if (!isNewerVersion(stableVer, currentVer)) return null

  return (
    <AlertBanner
      variant="info"
      icon={<ArrowUpCircle className="w-4 h-4" />}
      actions={showRedeployAction ? (
        <Button variant="outline" size="xs" onClick={onRedeploy}>
          Redeploy
        </Button>
      ) : undefined}
    >
      <p className="font-medium">A runtime update is available - redeploy to apply</p>
      <p className="mt-0.5 opacity-80">
        Your Claw is running {currentVer}; the current stable runtime is v{stableVer}.
      </p>
    </AlertBanner>
  )
}
