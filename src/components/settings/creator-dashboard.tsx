"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { ExternalLink, Plus, Package } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AlertBanner } from "@/components/ui/alert-banner"
import { Select } from "@/components/ui/select"
import { StatCard } from "@/components/ui/stat-card"
import { formatCurrencyRounded } from "@/lib/utils/format"
import { TrustBadge } from "@/components/marketplace/trust-badge"
import { MarketplaceComingSoonPanel } from "@/components/marketplace/coming-soon-panel"
import { Badge } from "@/components/ui/badge"
import { useSnackbarOptional } from "@/components/shared/snackbar"
import { mutateWithFeedback } from "@/lib/ui/mutate-with-feedback"
import {
  isMarketplaceCreatorEnrollEnabled,
  isMarketplacePublishEnabled,
} from "@/lib/marketplace/feature-flags"
import {
  creatorListingStatusClass,
  creatorListingStatusLabel,
} from "@/lib/marketplace/creator-listing-lifecycle"
import { CreatorListingMenu } from "@/components/settings/creator-listing-menu"
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
  pendingHold: number
  releasablePayout: number
  pendingPayout: number
  processingPayout: number
  paidOut: number
  nextPayoutDate: string | null
  totalSales: number
  lifecycleCopy: string
  recentSales?: Array<{
    id: string
    itemName: string
    payoutStatus: string
    creatorPayout: number
    isAdjustment?: boolean
    createdAt: string
  }>
}

type PayoutMethodChoice = "BANK" | "WISE" | "PAYPAL"

interface PayoutDetailsState {
  method: PayoutMethodChoice | null
  masked: string | null
  hasDetails: boolean
  updatedAt: string | null
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
  canDelete: boolean
  deleteBlockedReason: string | null
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
  canDelete: boolean
  deleteBlockedReason: string | null
}

export function CreatorDashboard() {
  const snackbar = useSnackbarOptional()
  const showSnackbar = useCallback(
    (options: Parameters<NonNullable<typeof snackbar>["show"]>[0]) => {
      snackbar?.show(options)
    },
    [snackbar],
  )
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

  const [payoutMeta, setPayoutMeta] = useState<PayoutDetailsState | null>(null)
  const [editingPayout, setEditingPayout] = useState(false)
  const [payoutMethod, setPayoutMethod] = useState<PayoutMethodChoice>("WISE")
  const [bankHolder, setBankHolder] = useState("")
  const [bankAccount, setBankAccount] = useState("")
  const [bankSwift, setBankSwift] = useState("")
  const [payoutEmail, setPayoutEmail] = useState("")
  const [savingPayout, setSavingPayout] = useState(false)

  const loadPayoutDetails = useCallback(() => {
    fetch("/api/creator/payout-details")
      .then((r) => r.json())
      .then((j) => {
        const d = j.data ?? j
        setPayoutMeta({
          method: d.method ?? null,
          masked: d.masked ?? null,
          hasDetails: !!d.hasDetails,
          updatedAt: d.updatedAt ?? null,
        })
        if (d.method) setPayoutMethod(d.method)
      })
      .catch(() => {})
  }, [])

  const loadListings = useCallback(() => {
    fetch("/api/creator/templates")
      .then((r) => r.json())
      .then((j) => setTemplates((j.data ?? j).templates ?? []))
      .catch(() => {})
    fetch("/api/creator/skills")
      .then((r) => r.json())
      .then((j) => setSkills((j.data ?? j).skills ?? []))
      .catch(() => {})
  }, [])

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
          loadListings()
          fetch("/api/creator/earnings").then((r) => r.json()).then((j) => setEarnings(j.data ?? j)).catch(() => {})
          loadPayoutDetails()
        }
      })
      .catch(() => setIsLoadingProfile(false))
  }, [loadPayoutDetails, loadListings])

  const handleSavePayoutDetails = async () => {
    setSavingPayout(true)
    try {
      await mutateWithFeedback(
        async () => {
          const body =
            payoutMethod === "BANK"
              ? {
                  method: "BANK" as const,
                  holderName: bankHolder.trim(),
                  accountOrIban: bankAccount.trim(),
                  swiftOrBic: bankSwift.trim() || undefined,
                }
              : {
                  method: payoutMethod,
                  email: payoutEmail.trim(),
                }
          const res = await fetch("/api/creator/payout-details", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
          const json = await res.json()
          if (!res.ok) throw new Error(json.error?.message || "Could not save payout details")
          setEditingPayout(false)
          setBankHolder("")
          setBankAccount("")
          setBankSwift("")
          setPayoutEmail("")
          loadPayoutDetails()
        },
        {
          message: "Payout details saved",
          errorMessage: "Could not save payout details",
        },
        showSnackbar,
      )
    } catch {
      /* snackbar shown */
    }
    setSavingPayout(false)
  }

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
      // Batch F: silent catch → mutateWithFeedback (success + failure snackbars).
      await mutateWithFeedback(
        async () => {
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
          if (!res.ok) throw new Error("Could not save profile")
          setProfileSaved(true)
          setTimeout(() => setProfileSaved(false), 3000)
        },
        {
          message: "Profile saved",
          errorMessage: "Could not save profile",
        },
        showSnackbar,
      )
    } catch {
      /* error snackbar already shown */
    }
    setIsSavingProfile(false)
  }

  if (isLoadingProfile) {
    return <div className="text-center py-10 text-[var(--tx2)] text-[12px]">Loading...</div>
  }

  if (enrolled === false && !isMarketplaceCreatorEnrollEnabled()) {
    return (
      <MarketplaceComingSoonPanel
        title="Creator enrollment coming soon"
        description="Publishing on the Claws marketplace opens when the creator economy arcs ship. Existing creator profiles are unchanged."
      />
    )
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
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatCard label="Pending (hold)" value={earnings ? formatCurrencyRounded(earnings.pendingHold ?? 0) : "$0"} />
        <StatCard label="Releasable" value={earnings ? formatCurrencyRounded(earnings.releasablePayout ?? 0) : "$0"} />
        <StatCard label="Processing" value={earnings ? formatCurrencyRounded(earnings.processingPayout ?? 0) : "$0"} />
        <StatCard label="Paid" value={earnings ? formatCurrencyRounded(earnings.paidOut) : "$0"} />
      </div>
      <p className="text-[11px] text-[var(--tx2)]">
        {earnings?.lifecycleCopy ??
          "Payouts are processed manually in batches. Status moves pending → releasable → processing → paid."}
      </p>
      {earnings?.recentSales && earnings.recentSales.length > 0 && (
        <div className="border border-[var(--bd)] rounded-[12px] p-[14px]">
          <h3 className="text-[13px] font-semibold text-[var(--tx)] mb-2">Recent sales</h3>
          <div className="space-y-1">
            {earnings.recentSales.slice(0, 8).map((s) => (
              <div key={s.id} className="flex justify-between text-[11px] text-[var(--tx2)]">
                <span>
                  {s.itemName}
                  {s.isAdjustment ? " (adjustment)" : ""} · {s.payoutStatus.toLowerCase()}
                </span>
                <span className="font-medium text-[var(--tx)]">{formatCurrencyRounded(s.creatorPayout)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="border border-[var(--bd)] rounded-[12px] p-[14px]">
        <div className="flex justify-between items-center mb-2">
          <h3 className="text-[13px] font-semibold text-[var(--tx)]">Payout details</h3>
          {payoutMeta?.hasDetails && !editingPayout && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setEditingPayout(true)
                setBankHolder("")
                setBankAccount("")
                setBankSwift("")
                setPayoutEmail("")
              }}
            >
              Edit
            </Button>
          )}
        </div>
        <p className="text-[11px] text-[var(--tx2)] mb-3">
          Encrypted at rest. We never show full account details after save — re-enter to change.
        </p>
        {payoutMeta?.hasDetails && !editingPayout ? (
          <div className="text-[12px] text-[var(--tx)] space-y-1">
            <p>
              Method:{" "}
              <span className="font-medium">
                {payoutMeta.method === "BANK"
                  ? "Bank transfer"
                  : payoutMeta.method === "WISE"
                    ? "Wise"
                    : payoutMeta.method === "PAYPAL"
                      ? "PayPal"
                      : "—"}
              </span>
            </p>
            <p>
              Details: <span className="font-mono">{payoutMeta.masked ?? "••••"}</span>
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="text-[11px] font-medium text-[var(--tx2)] mb-1 block">Method</label>
              <Select
                value={payoutMethod}
                onValueChange={(v) => setPayoutMethod(v as PayoutMethodChoice)}
                options={[
                  { value: "WISE", label: "Wise" },
                  { value: "BANK", label: "Bank transfer" },
                  { value: "PAYPAL", label: "PayPal" },
                ]}
                aria-label="Payout method"
              />
            </div>
            {payoutMethod === "BANK" ? (
              <>
                <div>
                  <label className="text-[11px] font-medium text-[var(--tx2)] mb-1 block">Account holder</label>
                  <Input value={bankHolder} onChange={(e) => setBankHolder(e.target.value)} placeholder="Full legal name" />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-[var(--tx2)] mb-1 block">IBAN or account number</label>
                  <Input value={bankAccount} onChange={(e) => setBankAccount(e.target.value)} placeholder="IBAN / account" />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-[var(--tx2)] mb-1 block">SWIFT / BIC (optional)</label>
                  <Input value={bankSwift} onChange={(e) => setBankSwift(e.target.value)} placeholder="SWIFT" />
                </div>
              </>
            ) : (
              <div>
                <label className="text-[11px] font-medium text-[var(--tx2)] mb-1 block">
                  {payoutMethod === "WISE" ? "Wise email" : "PayPal email"}
                </label>
                <Input
                  type="email"
                  value={payoutEmail}
                  onChange={(e) => setPayoutEmail(e.target.value)}
                  placeholder="you@example.com"
                />
              </div>
            )}
            <div className="flex gap-2">
              {editingPayout && (
                <Button size="sm" variant="outline" onClick={() => setEditingPayout(false)}>
                  Cancel
                </Button>
              )}
              <Button size="sm" onClick={() => void handleSavePayoutDetails()} loading={savingPayout}>
                Save payout details
              </Button>
            </div>
          </div>
        )}
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
            <Link href={`/creator/${profile.id}`} className="text-[11px] text-[var(--ac-text)] hover:text-[var(--tx)] ml-auto flex items-center gap-1">
              <ExternalLink size={10} aria-hidden="true" /> View public profile
            </Link>
          )}
        </div>
      </div>

      <div className="border border-[var(--bd)] rounded-[12px] p-[14px]">
        <div className="flex justify-between items-center mb-2">
          <h3 className="text-[13px] font-semibold text-[var(--tx)]">My Templates</h3>
          {isMarketplacePublishEnabled() ? (
            <Link href="/publish/template">
              <Button size="sm"><Plus size={12} className="mr-1" aria-hidden="true" /> Publish New</Button>
            </Link>
          ) : (
            <Badge variant="neutral">Coming soon</Badge>
          )}
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
                  <th className="text-right p-[6px] text-[var(--tx2)] font-medium"> </th>
                </tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id} className="border-b border-[var(--bd)] last:border-0">
                    <td className="p-[6px] font-medium text-[var(--tx)]">{t.name}</td>
                    <td className="p-[6px]">
                      <span className={`text-[10px] ${creatorListingStatusClass(t)}`}>
                        {creatorListingStatusLabel(t)}
                      </span>
                    </td>
                    <td className="p-[6px]"><TrustBadge tier={t.trustTier} /></td>
                    <td className="p-[6px] text-right">{t.installCount}</td>
                    <td className="p-[6px] text-right font-medium">{formatCurrencyRounded(t.revenue)}</td>
                    <td className="p-[6px] text-right">
                      <CreatorListingMenu
                        kind="template"
                        slug={t.slug}
                        name={t.name}
                        isPublished={t.isPublished}
                        reviewStatus={t.reviewStatus}
                        canDelete={t.canDelete ?? (t.salesCount === 0 && t.installCount === 0)}
                        deleteBlockedReason={t.deleteBlockedReason}
                        onChanged={loadListings}
                      />
                    </td>
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
          {isMarketplacePublishEnabled() ? (
            <Link href="/publish/skill">
              <Button size="sm"><Plus size={12} className="mr-1" aria-hidden="true" /> Publish New</Button>
            </Link>
          ) : (
            <Badge variant="neutral">Coming soon</Badge>
          )}
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
                  <th className="text-right p-[6px] text-[var(--tx2)] font-medium"> </th>
                </tr>
              </thead>
              <tbody>
                {skills.map((s) => (
                  <tr key={s.id} className="border-b border-[var(--bd)] last:border-0">
                    <td className="p-[6px] font-medium text-[var(--tx)]">{s.name}</td>
                    <td className="p-[6px]">
                      <span className={`text-[10px] ${creatorListingStatusClass(s)}`}>
                        {creatorListingStatusLabel(s)}
                      </span>
                    </td>
                    <td className="p-[6px]"><TrustBadge tier={s.trustTier} /></td>
                    <td className="p-[6px] text-right">{s.installCount}</td>
                    <td className="p-[6px] text-right font-medium">{formatCurrencyRounded(s.revenue ?? 0)}</td>
                    <td className="p-[6px] text-right">
                      <CreatorListingMenu
                        kind="skill"
                        slug={s.slug}
                        name={s.name}
                        isPublished={s.isPublished}
                        reviewStatus={s.reviewStatus}
                        canDelete={s.canDelete ?? (s.salesCount === 0 && s.installCount === 0)}
                        deleteBlockedReason={s.deleteBlockedReason}
                        onChanged={loadListings}
                      />
                    </td>
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
