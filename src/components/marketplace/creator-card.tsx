"use client"

import Link from "next/link"
import { TrustBadge } from "./trust-badge"

interface CreatorCardProps {
  creator: {
    id: string
    displayName: string
    avatarUrl?: string | null
    bio?: string | null
    totalTemplates?: number
    totalInstalls?: number
    averageRating?: number | null
  } | null
  isOfficial?: boolean
}

export function CreatorCard({ creator, isOfficial }: CreatorCardProps) {
  if (isOfficial || !creator) {
    return (
      <div className="flex items-center gap-[10px] p-[12px_14px] border border-[var(--bd)] rounded-[12px] bg-[var(--bg)]">
        <div className="w-9 h-9 rounded-full bg-[var(--tx)] text-[var(--bg)] flex items-center justify-center text-[13px] font-semibold shrink-0">
          C
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-[6px]">
            <span className="text-[13px] font-semibold text-[var(--tx)]">Claws Team</span>
            <TrustBadge tier="OFFICIAL" />
          </div>
          <p className="text-[11px] text-[var(--tx2)] truncate">
            Official templates by the Claws team
          </p>
        </div>
      </div>
    )
  }

  const stats = [
    creator.totalTemplates != null && `${creator.totalTemplates} templates`,
    creator.totalInstalls != null && `${creator.totalInstalls.toLocaleString()} installs`,
    creator.averageRating != null && `${creator.averageRating.toFixed(1)} avg rating`,
  ].filter(Boolean).join(" · ")

  return (
    <Link
      href={`/creator/${creator.id}`}
      className="flex items-center gap-[10px] p-[12px_14px] border border-[var(--bd)] rounded-[12px] bg-[var(--bg)] hover:border-[var(--bd2)] transition-colors"
    >
      {creator.avatarUrl ? (
        <img
          src={creator.avatarUrl}
          alt=""
          className="w-9 h-9 rounded-full object-cover shrink-0"
        />
      ) : (
        <div className="w-9 h-9 rounded-full bg-[var(--bg3)] flex items-center justify-center text-[13px] font-semibold text-[var(--tx)] shrink-0">
          {creator.displayName.charAt(0).toUpperCase()}
        </div>
      )}
      <div className="min-w-0">
        <span className="text-[13px] font-semibold text-[var(--tx)]">
          {creator.displayName}
        </span>
        {creator.bio && (
          <p className="text-[11px] text-[var(--tx2)] truncate">{creator.bio}</p>
        )}
        {stats && (
          <p className="text-[10px] text-[var(--tx3)] mt-[2px]">{stats}</p>
        )}
      </div>
    </Link>
  )
}
