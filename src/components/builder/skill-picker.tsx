"use client"

import { useBuilderStore } from "@/stores/builder-store"

interface SkillPickerProps {
  agentId: string
}

export function SkillPicker({ agentId }: SkillPickerProps) {
  const { skills, toggleSkill } = useBuilderStore()

  return (
    <div className="mb-2.5">
      <label className="block text-[10px] text-[var(--tx2)] font-medium mb-[3px]">Skills</label>
      <div className="space-y-1">
        {skills.map((skill) => (
          <label key={skill.id} className="flex items-center gap-1.5 text-[11px] cursor-pointer py-[2px]">
            <input
              type="checkbox"
              checked={skill.assigned}
              onChange={() => toggleSkill(agentId, skill.id)}
              className="rounded border-[var(--bd)] w-3 h-3 accent-[var(--tx)]"
            />
            <span className="text-[var(--tx)]">{skill.name}</span>
            <span className="text-[9px] text-[var(--tx3)]">{skill.category}</span>
          </label>
        ))}
      </div>
    </div>
  )
}
