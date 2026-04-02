"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { ExternalLink, Plus, Package } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AlertBanner } from "@/components/ui/alert-banner"
import { StatCard } from "@/components/ui/stat-card"
import { TrustBadge } from "@/components/marketplace/trust-badge"
import type { TrustTier } from "@/types/marketplace"

interface CreatorProfile {
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
}

interface EarningsData {
  totalEarned: number
  pendingPayout: number
  paidOut: number
  nextPayoutDate: string | null
  totalSales: number
}

interface PublishedTemplate {
  id: string
  name: string
  slug: string
  isPublished: boolean
  trustTier: TrustTier
  reviewStatus: string
  installCount: number
  avgRating: number | null
  price: number
  isFree: boolean
  revenue: number
  salesCount: number
}

interface PublishedSkill {
  id: string
  name: string
  slug: string
  emoji: string | null
  isPublished: boolean
  trustTier: TrustTier
  reviewStatus: string
  installCount: number
  avgRating: number | null
  price: number | null
  isFree: boolean
  revenue: number
  salesCount: number
}

export function CreatorDashboard() {
  const [enrolled, setEnrolled] = useState<boolean | null>(null)
  const [profile, setProfile] = useState<CreatorProfile | null>(null)
  const [isLoadingProfile, setIsLoadingProfile] = useState(true)

  const [showEnrollForm, setShowEnrollForm] = useState(false)
  const [enrollName, setEnrollName] = useState("")
  const [enrollBio, setEnrollBio] = useState("")
  const [enrollTwitter, setEnrollTwitter] = useState("")
  const [enrollGithub, setEnrollGithub] = useState("")
  const [enrollWebsite, setEnrollWebsite] = useState("")
  const [isEnrolling, setIsEnrolling] = useState(false)
  const [enrollError, setEnrollError] = useState<string | null>(null)

  const [editName, setEditName] = useState("")
  const [editBio, setEditBio] = useState("")
  const [editTwitter, setEditTwitter] = useState("")
  const [editGithub, setEditGithub] = useState("")
  const [editWebsite, setEditWebsite] = useState("")
  const [isSavingProfile, setIsSavingProfile] = useState(false)
  const [profileSaved, setProfileSaved] = useState(false)

  const [earnings, setEarnings] = useState<EarningsData | null>(null)
  const [templates, setTemplates] = useState<PublishedTemplate[]>([])
  const [skills, setSkills] = useState<PublishedSkill[]>([])

  useEffect(() => {
    fetch("/api/creator/profile")
      .then((r) => r.json())
      .then((json) => {
        const d = json.data ?? json
        setEnrolled(d.enrolled)
        if (d.profile) {
          setProfile(d.profile)
          setEditName(d.profile.displayName ?? "")
          setEditBio(d.profile.bio ?? "")
          setEditTwitter(d.profile.twitterUrl ?? "")
          setEditGithub(d.profile.githubUrl ?? "")
          setEditWebsite(d.profile.websiteUrl ?? "")
        }
        setIsLoadingProfile(false)

        if (d.enrolled) {
          fetch("/api/creator/earnings").then((r) => r.json()).then((j) => setEarnings(j.data ?? j)).catch(() => {})
          fetch("/api/creator/templates").then((r) => r.json()).then((j) => setTemplates((j.data ?? j).templates ?? [])).catch(() => {})
          fetch("/api/creator/skills").then((r) => r.json()).then((j) => setSkills((j.data ?? j).skills ?? [])).catch(() => {})
        }
      })
      .catch(() => setIsLoadingProfile(false))
  }, [])

  const handleEnroll = async () => {
    if (!enrollName.trim()) { setEnrollError("Display name is required"); return }
    setIsEnrolling(true)
    setEnrollError(null)
    try {
      const res = await fetch("/api/creator/enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: enrollName.trim(),
          bio: enrollBio.trim() || null,
          twitterUrl: enrollTwitter.trim() || null,
          githubUrl: enrollGithub.trim() || null,
          websiteUrl: enrollWebsite.trim() || null,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error?.message || "Enrollment failed")
      }
      window.location.reload()
    } catch (err: unknown) {
      setEnrollError(err instanceof Error ? err.message : "Enrollment failed")
    }
    setIsEnrolling(false)
  }

  const handleSaveProfile = async () => {
    setIsSavingProfile(true)
    setProfileSaved(false)
    try {
      const res = await fetch("/api/creator/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: editName.trim(),
          bio: editBio.trim() || null,
          twitterUrl: editTwitter.trim() || null,
          githubUrl: editGithub.trim() || null,
          websiteUrl: editWebsite.trim() || null,
        }),
      })
      if (!res.ok) throw new Error("Save failed")
      setProfileSaved(true)
      setTimeout(() => setProfileSaved(false), 3000)
    } catch { /* show nothing for now */ }
    setIsSavingProfile(false)
  }

  if (isLoadingProfile) {
    return <div className="text-center py-10 text-[var(--tx2)] text-[12px]">Loading...</div>
  }

  if (enrolled === false && !showEnrollForm) {
    return (
      <div className="border border-[var(--bd)] rounded-[12px] p-8 text-center max-w-md mx-auto">
        <Package size={32} className="mx-auto mb-3 text-[var(--tx3)]" />
        <h2 className="text-[16px] font-semibold text-[var(--tx)]">Become a Creator</h2>
        <p className="text-[12px] text-[var(--tx2)] mt-1 max-w-[300px] mx-auto">
          Publish templates and skills on the Claws marketplace. Keep 100% of your revenue.
        </p>
        <Button className="mt-4" onClick={() => setShowEnrollForm(true)}>
          Get Started
        </Button>
      </div>
    )
  }

  if (enrolled === false && showEnrollForm) {
    return (
      <div className="border border-[var(--bd)] rounded-[12px] p-5 max-w-md mx-auto">
        <h2 className="text-[16px] font-semibold text-[var(--tx)] mb-3">Create Your Profile</h2>
        {enrollError && <AlertBanner variant="error"><p>{enrollError}</p></AlertBanner>}
        <div className="space-y-3">
          <div>
            <label className="text-[11px] font-medium text-[var(--tx2)] mb-1 block">Display Name *</label>
            <Input value={enrollName} onChange={(e) => setEnrollName(e.target.value)} placeholder="Your creator name" maxLength={50} />
          </div>
          <div>
            <label className="text-[11px] font-medium text-[var(--tx2)] mb-1 block">Bio</label>
            <textarea value={enrollBio} onChange={(e) => setEnrollBio(e.target.value)} placeholder="Tell people about yourself" maxLength={500} rows={3} className="w-full px-[10px] py-2 border border-[var(--bd)] rounded-[6px] text-[12px] text-[var(--tx)] bg-[var(--bg)] resize-none focus:border-[var(--tx)] focus:outline-none" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-medium text-[var(--tx2)] mb-1 block">Twitter URL</label>
              <Input value={enrollTwitter} onChange={(e) => setEnrollTwitter(e.target.value)} placeholder="https://twitter.com/..." />
            </div>
            <div>
              <label className="text-[11px] font-medium text-[var(--tx2)] mb-1 block">GitHub URL</label>
              <Input value={enrollGithub} onChange={(e) => setEnrollGithub(e.target.value)} placeholder="https://github.com/..." />
            </div>
          </div>
          <div>
            <label className="text-[11px] font-medium text-[var(--tx2)] mb-1 block">Website</label>
            <Input value={enrollWebsite} onChange={(e) => setEnrollWebsite(e.target.value)} placeholder="https://..." />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setShowEnrollForm(false)}>Cancel</Button>
            <Button onClick={handleEnroll} loading={isEnrolling}>Create Profile</Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-[14px]">
      <div className="grid grid-cols-3 gap-2">
        <StatCard label="Total Earned" value={earnings ? `$${earnings.totalEarned.toFixed(0)}` : "$0"} />
        <StatCard label="Pending Payout" value={earnings ? `$${earnings.pendingPayout.toFixed(0)}` : "$0"} />
        <StatCard label="Next Payout" value={earnings?.nextPayoutDate ? new Date(earnings.nextPayoutDate).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "-"} />
      </div>

      <div className="border border-[var(--bd)] rounded-[12px] p-[14px]">
        <h3 className="text-[13px] font-semibold text-[var(--tx)] mb-2">Your Profile</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] font-medium text-[var(--tx2)] mb-1 block">Display Name</label>
            <Input value={editName} onChange={(e) => setEditName(e.target.value)} maxLength={50} />
          </div>
          <div>
            <label className="text-[11px] font-medium text-[var(--tx2)] mb-1 block">Website</label>
            <Input value={editWebsite} onChange={(e) => setEditWebsite(e.target.value)} placeholder="https://..." />
          </div>
          <div>
            <label className="text-[11px] font-medium text-[var(--tx2)] mb-1 block">Twitter</label>
            <Input value={editTwitter} onChange={(e) => setEditTwitter(e.target.value)} />
          </div>
          <div>
            <label className="text-[11px] font-medium text-[var(--tx2)] mb-1 block">GitHub</label>
            <Input value={editGithub} onChange={(e) => setEditGithub(e.target.value)} />
          </div>
        </div>
        <div className="mt-3">
          <label className="text-[11px] font-medium text-[var(--tx2)] mb-1 block">Bio</label>
          <textarea value={editBio} onChange={(e) => setEditBio(e.target.value)} maxLength={500} rows={3} className="w-full px-[10px] py-2 border border-[var(--bd)] rounded-[6px] text-[12px] text-[var(--tx)] bg-[var(--bg)] resize-none focus:border-[var(--tx)] focus:outline-none" />
        </div>
        <div className="flex items-center gap-2 mt-3">
          <Button size="sm" onClick={handleSaveProfile} loading={isSavingProfile}>Save Profile</Button>
          {profileSaved && <span className="text-[11px] text-[var(--ok)]">Saved</span>}
          {profile && (
            <Link href={`/creator/${profile.id}`} className="text-[11px] text-[var(--ac)] hover:text-[var(--tx)] ml-auto flex items-center gap-1">
              <ExternalLink size={10} aria-hidden="true" /> View public profile
            </Link>
          )}
        </div>
      </div>

      <div className="border border-[var(--bd)] rounded-[12px] p-[14px]">
        <div className="flex justify-between items-center mb-2">
          <h3 className="text-[13px] font-semibold text-[var(--tx)]">My Templates</h3>
          <Link href="/publish/template">
            <Button size="sm"><Plus size={12} className="mr-1" aria-hidden="true" /> Publish New</Button>
          </Link>
        </div>
        {templates.length === 0 ? (
          <p className="text-[12px] text-[var(--tx3)]">No templates published yet. Publish your first!</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr className="border-b border-[var(--bd)]">
                  <th className="text-left p-[6px] text-[var(--tx2)] font-medium">Name</th>
                  <th className="text-left p-[6px] text-[var(--tx2)] font-medium">Status</th>
                  <th className="text-left p-[6px] text-[var(--tx2)] font-medium">Trust</th>
                  <th className="text-right p-[6px] text-[var(--tx2)] font-medium">Installs</th>
                  <th className="text-right p-[6px] text-[var(--tx2)] font-medium">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id} className="border-b border-[var(--bd)] last:border-0">
                    <td className="p-[6px] font-medium text-[var(--tx)]">{t.name}</td>
                    <td className="p-[6px]">
                      <span className={`text-[10px] ${t.isPublished ? "text-[var(--ok)]" : t.reviewStatus === "REJECTED" ? "text-[var(--err)]" : "text-[var(--warn)]"}`}>
                        {t.isPublished ? "Published" : t.reviewStatus === "REJECTED" ? "Rejected" : "Under Review"}
                      </span>
                    </td>
                    <td className="p-[6px]"><TrustBadge tier={t.trustTier} /></td>
                    <td className="p-[6px] text-right">{t.installCount}</td>
                    <td className="p-[6px] text-right font-medium">${t.revenue.toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="border border-[var(--bd)] rounded-[12px] p-[14px]">
        <div className="flex justify-between items-center mb-2">
          <h3 className="text-[13px] font-semibold text-[var(--tx)]">My Skills</h3>
          <Link href="/publish/skill">
            <Button size="sm"><Plus size={12} className="mr-1" aria-hidden="true" /> Publish New</Button>
          </Link>
        </div>
        {skills.length === 0 ? (
          <p className="text-[12px] text-[var(--tx3)]">No skills published yet. Publish your first!</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr className="border-b border-[var(--bd)]">
                  <th className="text-left p-[6px] text-[var(--tx2)] font-medium">Name</th>
                  <th className="text-left p-[6px] text-[var(--tx2)] font-medium">Status</th>
                  <th className="text-left p-[6px] text-[var(--tx2)] font-medium">Trust</th>
                  <th className="text-right p-[6px] text-[var(--tx2)] font-medium">Installs</th>
                  <th className="text-right p-[6px] text-[var(--tx2)] font-medium">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {skills.map((s) => (
                  <tr key={s.id} className="border-b border-[var(--bd)] last:border-0">
                    <td className="p-[6px] font-medium text-[var(--tx)]">{s.name}</td>
                    <td className="p-[6px]">
                      <span className={`text-[10px] ${s.isPublished ? "text-[var(--ok)]" : s.reviewStatus === "REJECTED" ? "text-[var(--err)]" : "text-[var(--warn)]"}`}>
                        {s.isPublished ? "Published" : s.reviewStatus === "REJECTED" ? "Rejected" : "Under Review"}
                      </span>
                    </td>
                    <td className="p-[6px]"><TrustBadge tier={s.trustTier} /></td>
                    <td className="p-[6px] text-right">{s.installCount}</td>
                    <td className="p-[6px] text-right font-medium">${(s.revenue ?? 0).toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
