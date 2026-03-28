"use client"

import Link from "next/link"
import { TrustBadge } from "./trust-badge"
import type { TrustTier } from "@/types/marketplace"

interface SkillCardProps {
  skill: {
    slug: string
    name: string
    emoji?: string | null
    description: string
    category: string
    trustTier: TrustTier
    installCount: number
    isFree: boolean
    price?: number | null
  }
}

export function SkillCard({ skill }: SkillCardProps) {
  return (
    <Link
      href={`/store/skills/${skill.slug}`}
      className="block border border-[var(--bd)] rounded-[12px] px-[14px] py-3 hover:border-[var(--bd2)] transition-[border-color] duration-150 cursor-pointer"
    >
      <div className="flex justify-between items-center">
        <span className="text-[13px] font-semibold text-[var(--tx)]">
          {skill.name}
        </span>
        <TrustBadge tier={skill.trustTier} />
      </div>

      <p className="text-[11px] text-[var(--tx2)] mt-1 line-clamp-2">
        {skill.description}
      </p>

      <div className="flex justify-between items-center mt-2">
        <span className="text-[9px] font-medium px-[6px] py-[1px] rounded-[4px] border border-[var(--bd)] text-[var(--tx2)] bg-[var(--bg2)]">
          {skill.category}
        </span>
        <span className="text-[10px] text-[var(--tx3)]">
          {skill.installCount.toLocaleString()} installs
        </span>
      </div>

      {skill.isFree ? (
        <div className="text-[12px] font-bold text-[var(--ok)] mt-1">Free</div>
      ) : skill.price ? (
        <div className="text-[13px] font-bold text-[var(--tx)] mt-1">
          ${skill.price}
        </div>
      ) : null}
    </Link>
  )
}
