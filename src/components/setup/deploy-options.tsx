"use client"

import { Button } from "@/components/ui/button"

interface DeployOptionsProps {
  selected: "cloud" | "self-hosted"
  onSelect: (option: "cloud" | "self-hosted") => void
  onDeploy: () => void
  onDownload: () => void
  isDeploying: boolean
  isDownloading: boolean
}

export function DeployOptions({ selected, onSelect, onDeploy, onDownload, isDeploying, isDownloading }: DeployOptionsProps) {
  return (
    <div className="grid grid-cols-2 gap-2.5 mb-4">
      <div
        onClick={() => onSelect("cloud")}
        className={`rounded-lg p-3.5 text-center cursor-pointer transition-colors ${selected === "cloud" ? "border-2 border-[var(--tx)]" : "border border-[var(--bd)]"}`}
      >
        <p className="text-[10px] font-semibold text-[var(--tx)] mb-1">RECOMMENDED</p>
        <h3 className="text-[15px] font-semibold text-[var(--tx)]">Cloud hosted</h3>
        <p className="text-[11px] text-[var(--tx2)]">We run it. $12/month.</p>
        <p className="text-[10px] text-[var(--ok)] mt-1">Zero maintenance · Auto-updates · 99.9% uptime</p>
        <Button variant="primary" className="mt-2" onClick={(e) => { e.stopPropagation(); onDeploy() }} disabled={selected !== "cloud" || isDeploying}>
          {isDeploying ? "Deploying..." : "Deploy to cloud"}
        </Button>
      </div>
      <div
        onClick={() => onSelect("self-hosted")}
        className={`rounded-lg p-3.5 text-center cursor-pointer transition-colors ${selected === "self-hosted" ? "border-2 border-[var(--tx)]" : "border border-[var(--bd)]"}`}
      >
        <h3 className="text-[15px] font-semibold">Self-hosted</h3>
        <p className="text-[11px] text-[var(--tx2)]">Download configs.</p>
        <p className="text-[10px] text-[var(--tx2)] mt-1">Full control · No hosting fee</p>
        <Button variant="outline" className="mt-2" onClick={(e) => { e.stopPropagation(); onDownload() }} disabled={selected !== "self-hosted" || isDownloading}>
          {isDownloading ? "Generating..." : "Download config package"}
        </Button>
      </div>
    </div>
  )
}
