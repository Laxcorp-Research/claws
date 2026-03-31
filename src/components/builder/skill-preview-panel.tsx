"use client"

import { X } from "lucide-react"

interface SkillPreviewPanelProps {
  skill: { id: string; name: string; category: string; description?: string } | null
  onClose: () => void
}

export function SkillPreviewPanel({ skill, onClose }: SkillPreviewPanelProps) {
  if (!skill) return null

  return (
    <div className="border border-[var(--bd)] rounded-[6px] p-[8px] mt-[6px] bg-[var(--bg)] relative">
      <button
        onClick={onClose}
        className="absolute top-[6px] right-[6px] p-[2px] rounded-[3px] hover:bg-[var(--bg2)] transition-colors cursor-pointer border-none bg-transparent"
        aria-label="Close preview"
      >
        <X className="w-[10px] h-[10px] text-[var(--tx3)]" />
      </button>

      <div className="text-[11px] font-medium text-[var(--tx)] mb-[2px] pr-[16px]">
        {skill.name}
      </div>
      <div className="text-[9px] text-[var(--tx3)] uppercase mb-[4px]">
        {skill.category}
      </div>
      {skill.description ? (
        <p className="text-[10px] text-[var(--tx2)] leading-[1.4]">{skill.description}</p>
      ) : (
        <p className="text-[10px] text-[var(--tx3)] italic">No description available</p>
      )}
    </div>
  )
}
