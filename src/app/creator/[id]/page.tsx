"use client"

import { useState, useEffect } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { Twitter, Github, Globe, Star } from "lucide-react"
import { PageShell } from "@/components/shared/page-shell"
import { AlertBanner } from "@/components/ui/alert-banner"
import { StatCard } from "@/components/ui/stat-card"
import { TrustBadge } from "@/components/marketplace/trust-badge"
import { SkillCard } from "@/components/marketplace/skill-card"
import type { TrustTier } from "@/types/marketplace"

interface CreatorProfileData {
  id: string
  displayName: string
  bio: string | null
  avatarUrl: string | null
  twitterUrl: string | null
  githubUrl: string | null
  websiteUrl: string | null
  totalTemplates: number
  totalSkills: number
  totalInstalls: number
  averageRating: number
  isActive: boolean
}

interface CreatorTemplate {
  id: string
  name: string
  slug: string
  tagline: string
  price: number
  isFree: boolean
  category: string
  trustTier: TrustTier
  installCount: number
  avgRating: number | null
}

interface CreatorSkill {
  id: string
  slug: string
  name: string
  emoji: string | null
  description: string
  category: string
  trustTier: TrustTier
  installCount: number
  isFree: boolean
  price: number | null
  avgRating: number | null
}

interface PageData {
  profile: CreatorProfileData
  templates: CreatorTemplate[]
  skills: CreatorSkill[]
}

export default function CreatorProfilePage() {
  const params = useParams<{ id: string }>()
  const creatorId = params.id

  const [data, setData] = useState<PageData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/creator/${creatorId}`)
      .then((res) => {
        if (!res.ok) throw new Error(res.status === 404 ? "Creator not found" : "Failed to load")
        return res.json()
      })
      .then((json) => {
        setData(json.data ?? json)
        setIsLoading(false)
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to load")
        setIsLoading(false)
      })
  }, [creatorId])

  if (isLoading) {
    return (
      <PageShell background="secondary">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="space-y-4">
            <div className="flex gap-4">
              <div className="w-16 h-16 rounded-full bg-[var(--bg3)] animate-pulse" />
              <div className="flex-1 space-y-2">
                <div className="h-5 bg-[var(--bg3)] rounded w-40 animate-pulse" />
                <div className="h-3 bg-[var(--bg3)] rounded w-60 animate-pulse" />
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {[1, 2, 3, 4].map((i) => <div key={i} className="h-16 bg-[var(--bg3)] rounded animate-pulse" />)}
            </div>
          </div>
        </div>
      </PageShell>
    )
  }

  if (error || !data) {
    return (
      <PageShell background="secondary">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <AlertBanner variant="error">
            <p className="font-medium">{error || "Creator not found"}</p>
          </AlertBanner>
        </div>
      </PageShell>
    )
  }

  const { profile, templates, skills } = data
  const hasVerified = templates.some((t) => t.trustTier === "VERIFIED") || skills.some((s) => s.trustTier === "VERIFIED")

  return (
    <PageShell background="secondary">
      <div className="max-w-4xl mx-auto px-4 py-4">
        {!profile.isActive && (
          <AlertBanner variant="warning">
            <p className="font-medium">This creator is no longer active.</p>
          </AlertBanner>
        )}

        <div className="flex gap-4 items-start mb-4">
          {profile.avatarUrl ? (
            <img src={profile.avatarUrl} alt="" className="w-16 h-16 rounded-full object-cover shrink-0" />
          ) : (
            <div className="w-16 h-16 rounded-full bg-[var(--bg3)] flex items-center justify-center text-[20px] font-semibold text-[var(--tx)] shrink-0">
              {profile.displayName.charAt(0).toUpperCase()}
            </div>
          )}
          <div>
            <div className="flex gap-2 items-center">
              <h1 className="text-[20px] font-semibold text-[var(--tx)]">{profile.displayName}</h1>
              {hasVerified && <TrustBadge tier="VERIFIED" />}
            </div>
            {profile.bio && (
              <p className="text-[13px] text-[var(--tx2)] mt-1">{profile.bio}</p>
            )}
            <div className="flex gap-3 mt-2">
              {profile.twitterUrl && (
                <a href={profile.twitterUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-[var(--ac-text)] hover:text-[var(--tx)] flex items-center gap-1">
                  <Twitter size={12} aria-hidden="true" /> Twitter
                </a>
              )}
              {profile.githubUrl && (
                <a href={profile.githubUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-[var(--ac-text)] hover:text-[var(--tx)] flex items-center gap-1">
                  <Github size={12} aria-hidden="true" /> GitHub
                </a>
              )}
              {profile.websiteUrl && (
                <a href={profile.websiteUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-[var(--ac-text)] hover:text-[var(--tx)] flex items-center gap-1">
                  <Globe size={12} aria-hidden="true" /> Website
                </a>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-2 mb-4">
          <StatCard label="Templates" value={profile.totalTemplates} />
          <StatCard label="Skills" value={profile.totalSkills} />
          <StatCard label="Total Installs" value={profile.totalInstalls.toLocaleString()} />
          <StatCard
            label="Avg Rating"
            value={
              profile.averageRating > 0
                ? profile.averageRating.toFixed(1)
                : "-"
            }
          />
        </div>

        {templates.length > 0 && (
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-[var(--tx)] mb-2">Templates</h2>
            <div className="space-y-2">
              {templates.map((t) => (
                <Link
                  key={t.id}
                  href={`/store/${t.slug}`}
                  className="block border border-[var(--bd)] rounded-[12px] p-3 hover:border-[var(--bd2)] transition-colors"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-semibold text-[var(--tx)]">{t.name}</span>
                        <TrustBadge tier={t.trustTier} />
                      </div>
                      <p className="text-[11px] text-[var(--tx2)] mt-1 line-clamp-2">{t.tagline}</p>
                    </div>
                    <span className="text-[13px] font-bold text-[var(--tx)] shrink-0 ml-3">
                      {t.isFree ? <span className="text-[var(--ok)]">Free</span> : `$${t.price}`}
                    </span>
                  </div>
                  <div className="flex gap-3 mt-2 text-[10px] text-[var(--tx3)]">
                    <span>{t.installCount} installs</span>
                    {t.avgRating != null && t.avgRating > 0 && (
                      <span className="flex items-center gap-[2px]">
                        <Star size={9} fill="#FFDC6E" stroke="#FFDC6E" aria-hidden="true" />
                        {t.avgRating.toFixed(1)}
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
        {templates.length === 0 && (
          <p className="text-[12px] text-[var(--tx3)] mb-4">No templates published yet.</p>
        )}

        {skills.length > 0 && (
          <div>
            <h2 className="text-sm font-semibold text-[var(--tx)] mb-2">Skills</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {skills.map((s) => (
                <SkillCard key={s.id} skill={s} />
              ))}
            </div>
          </div>
        )}
        {skills.length === 0 && (
          <p className="text-[12px] text-[var(--tx3)]">No skills published yet.</p>
        )}
      </div>
    </PageShell>
  )
}
