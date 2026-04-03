"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { Search, Plus, Check, ExternalLink } from "lucide-react"
import { TruncateWithTooltip } from "@/components/ui/truncate-with-tooltip"

interface MarketplaceSkillsModalProps {
  isOpen: boolean
  onClose: () => void
  existingSkillIds: string[]
  onInstall: (skill: { id: string; name: string; slug: string; category: string; description: string }) => void
}

interface MarketplaceSkillItem {
  id: string
  name: string
  slug: string
  description: string
  category: string
  installCount: number
  trustTier: string
}

const CATEGORIES = [
  "All", "Developer", "Productivity", "System", "Search", "Communication",
  "Marketing", "Data", "CRM", "Email", "Finance", "Security", "Social", "Web",
]

export function MarketplaceSkillsModal({ isOpen, onClose, existingSkillIds, onInstall }: MarketplaceSkillsModalProps) {
  const [allSkills, setAllSkills] = useState<MarketplaceSkillItem[]>([])
  const [search, setSearch] = useState("")
  const [category, setCategory] = useState("All")
  const [loading, setLoading] = useState(false)
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set(existingSkillIds))
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [expandedSkillId, setExpandedSkillId] = useState<string | null>(null)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchSkills = useCallback(async (cursor?: string) => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set("search", search)
      if (category !== "All") params.set("category", category)
      params.set("limit", "50")
      params.set("sort", "popular")
      if (cursor) params.set("cursor", cursor)

      const res = await fetch(`/api/marketplace/skills?${params}`)
      if (res.ok) {
        const data = await res.json()
        const items: MarketplaceSkillItem[] = data.data?.items || data.data || []
        const newCursor: string | null = data.data?.nextCursor || null

        if (cursor) {
          setAllSkills(prev => [...prev, ...items])
        } else {
          setAllSkills(items)
        }
        setNextCursor(newCursor)
      }
    } catch (err) {
      console.error("Failed to fetch marketplace skills:", err)
    } finally {
      setLoading(false)
    }
  }, [search, category])

  useEffect(() => {
    if (isOpen) {
      setAllSkills([])
      setNextCursor(null)
      setExpandedSkillId(null)
      fetchSkills()
    }
  }, [isOpen, category]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isOpen) return
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => {
      setAllSkills([])
      setNextCursor(null)
      fetchSkills()
    }, 300)
    return () => { if (searchTimerRef.current) clearTimeout(searchTimerRef.current) }
  }, [search]) // eslint-disable-line react-hooks/exhaustive-deps

  const [bridging, setBridging] = useState<string | null>(null)

  async function handleInstall(skill: MarketplaceSkillItem) {
    setBridging(skill.id)
    try {
      const res = await fetch("/api/skills/from-marketplace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ marketplaceSkillId: skill.id }),
      })

      if (!res.ok) {
        console.error("Failed to bridge skill:", res.status)
        return
      }

      const json = await res.json()
      const bridged = json.data || json

      onInstall({
        id: bridged.id,
        name: bridged.name || skill.name,
        slug: bridged.slug || skill.slug,
        category: bridged.category || skill.category,
        description: bridged.description || skill.description || "",
      })
      setAddedIds(prev => new Set([...prev, skill.id]))
    } catch (err) {
      console.error("Failed to add skill:", err)
    } finally {
      setBridging(null)
    }
  }

  if (!isOpen) return null

  return (
    <Modal open={isOpen} onClose={onClose} title="Add Skills from Marketplace" size="lg">
      <div>
        <p className="text-[12px] text-[var(--tx2)] mb-[14px]">
          Browse community skills. Adding a skill makes it available for agents in this Claw.
        </p>

        <div className="relative mb-[10px]">
          <Search className="absolute left-[10px] top-1/2 -translate-y-1/2 w-[14px] h-[14px] text-[var(--tx3)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search skills..."
            className="w-full pl-[32px] pr-[10px] py-[8px] border border-[var(--bd)] rounded-[6px] text-[12px] bg-[var(--bg)] text-[var(--tx)] focus:border-[var(--tx)] focus:outline-none"
          />
        </div>

        <div className="flex gap-[4px] flex-wrap mb-[12px]">
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`px-[8px] py-[3px] rounded-[4px] text-[10px] border transition-colors cursor-pointer ${
                category === cat
                  ? "bg-[var(--tx)] text-white border-[var(--tx)]"
                  : "bg-[var(--bg)] text-[var(--tx2)] border-[var(--bd)] hover:border-[var(--tx3)]"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="max-h-[350px] overflow-y-auto border border-[var(--bd)] rounded-[8px]">
          {loading && allSkills.length === 0 ? (
            <div className="p-[20px] text-center text-[12px] text-[var(--tx3)]">Loading skills...</div>
          ) : allSkills.length === 0 ? (
            <div className="p-[20px] text-center text-[12px] text-[var(--tx3)]">
              No skills found. Try a different search or category.
            </div>
          ) : (
            <>
              {allSkills.map(skill => {
                const isAdded = addedIds.has(skill.id)
                const isExpanded = expandedSkillId === skill.id

                return (
                  <div key={skill.id} className="border-b border-[var(--bd)] last:border-b-0">
                    <div className="flex items-center justify-between px-[12px] py-[8px]">
                      <button
                        type="button"
                        onClick={() => setExpandedSkillId(isExpanded ? null : skill.id)}
                        className="flex-1 min-w-0 mr-[10px] text-left border-none bg-transparent cursor-pointer p-0"
                      >
                        <div className="flex items-center gap-[6px]">
                          <TruncateWithTooltip className="text-[12px] font-medium text-[var(--tx)] hover:underline">{skill.name}</TruncateWithTooltip>
                          <span className="text-[9px] text-[var(--tx3)] uppercase flex-shrink-0">{skill.category}</span>
                        </div>
                        <TruncateWithTooltip className="text-[11px] text-[var(--tx3)] mt-[1px]" as="div">{skill.description}</TruncateWithTooltip>
                      </button>

                      {isAdded ? (
                        <span className="flex items-center gap-[4px] text-[10px] text-[var(--ok)] font-medium flex-shrink-0">
                          <Check className="w-[12px] h-[12px]" />
                          Added
                        </span>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => handleInstall(skill)} disabled={bridging === skill.id} className="flex-shrink-0">
                          <Plus className="w-[12px] h-[12px] mr-[3px]" />
                          {bridging === skill.id ? "Adding..." : "Add"}
                        </Button>
                      )}
                    </div>

                    {isExpanded && (
                      <div className="px-[12px] pb-[10px]">
                        <div className="bg-[var(--bg2)] rounded-[6px] p-[10px] text-[11px] text-[var(--tx2)] leading-[1.5]">
                          <div className="flex items-center gap-[8px] mb-[6px]">
                            <span className="text-[9px] font-medium text-[var(--tx3)] uppercase">{skill.category}</span>
                            <span className="text-[9px] text-[var(--tx3)]">{skill.installCount} installs</span>
                            {skill.trustTier !== "UNREVIEWED" && (
                              <span className={`text-[9px] font-medium ${
                                skill.trustTier === "OFFICIAL" ? "text-[#1e40af]" :
                                skill.trustTier === "VERIFIED" ? "text-[#166534]" :
                                "text-[var(--tx3)]"
                              }`}>
                                {skill.trustTier}
                              </span>
                            )}
                          </div>
                          <p>{skill.description || "No detailed description available."}</p>
                          <a
                            href={`/store/skills/${skill.slug}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-[3px] text-[10px] text-[var(--ac)] hover:underline mt-[6px]"
                          >
                            View full details
                            <ExternalLink className="w-[10px] h-[10px]" />
                          </a>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}

              {nextCursor && (
                <div className="p-[10px] text-center">
                  <button
                    type="button"
                    onClick={() => fetchSkills(nextCursor)}
                    disabled={loading}
                    className="text-[11px] text-[var(--ac)] hover:underline disabled:opacity-50 cursor-pointer border-none bg-transparent"
                  >
                    {loading ? "Loading..." : "Load more skills"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-between mt-[12px]">
          <span className="text-[11px] text-[var(--tx3)]">
            {allSkills.length} skills shown{nextCursor ? " (more available)" : ""}
          </span>
          <Button size="sm" variant="outline" onClick={onClose}>Done</Button>
        </div>
      </div>
    </Modal>
  )
}
