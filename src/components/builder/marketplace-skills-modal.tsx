"use client"

import { useState, useEffect, useCallback } from "react"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { Search, Plus, Check } from "lucide-react"

interface MarketplaceSkillsModalProps {
  isOpen: boolean
  onClose: () => void
  existingSkillIds: string[]
  onInstall: (skill: { id: string; name: string; slug: string; category: string }) => void
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
  const [skills, setSkills] = useState<MarketplaceSkillItem[]>([])
  const [search, setSearch] = useState("")
  const [category, setCategory] = useState("All")
  const [loading, setLoading] = useState(false)
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set(existingSkillIds))

  const fetchSkills = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (search) params.set("search", search)
      if (category !== "All") params.set("category", category)
      params.set("limit", "50")
      params.set("sort", "popular")

      const res = await fetch(`/api/marketplace/skills?${params}`)
      if (res.ok) {
        const data = await res.json()
        setSkills(data.data?.items || data.data || [])
      }
    } catch (err) {
      console.error("Failed to fetch marketplace skills:", err)
    } finally {
      setLoading(false)
    }
  }, [search, category])

  useEffect(() => {
    if (isOpen) fetchSkills()
  }, [isOpen, fetchSkills])

  useEffect(() => {
    if (!isOpen) return
    const timer = setTimeout(fetchSkills, 300)
    return () => clearTimeout(timer)
  }, [search]) // eslint-disable-line react-hooks/exhaustive-deps

  function handleInstall(skill: MarketplaceSkillItem) {
    onInstall({ id: skill.id, name: skill.name, slug: skill.slug, category: skill.category })
    setAddedIds(prev => new Set([...prev, skill.id]))
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
          {loading ? (
            <div className="p-[20px] text-center text-[12px] text-[var(--tx3)]">Loading skills...</div>
          ) : skills.length === 0 ? (
            <div className="p-[20px] text-center text-[12px] text-[var(--tx3)]">
              No skills found. Try a different search or category.
            </div>
          ) : (
            skills.map(skill => {
              const isAdded = addedIds.has(skill.id)
              return (
                <div
                  key={skill.id}
                  className="flex items-center justify-between px-[12px] py-[8px] border-b border-[var(--bd)] last:border-b-0"
                >
                  <div className="flex-1 min-w-0 mr-[10px]">
                    <div className="flex items-center gap-[6px]">
                      <span className="text-[12px] font-medium text-[var(--tx)] truncate">{skill.name}</span>
                      <span className="text-[9px] text-[var(--tx3)] uppercase flex-shrink-0">{skill.category}</span>
                    </div>
                    <div className="text-[11px] text-[var(--tx3)] truncate mt-[1px]">{skill.description}</div>
                  </div>

                  {isAdded ? (
                    <span className="flex items-center gap-[4px] text-[10px] text-[var(--ok)] font-medium flex-shrink-0">
                      <Check className="w-[12px] h-[12px]" />
                      Added
                    </span>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => handleInstall(skill)} className="flex-shrink-0">
                      <Plus className="w-[12px] h-[12px] mr-[3px]" />
                      Add
                    </Button>
                  )}
                </div>
              )
            })
          )}
        </div>

        <div className="flex items-center justify-between mt-[12px]">
          <span className="text-[11px] text-[var(--tx3)]">{skills.length} skills shown</span>
          <Button size="sm" variant="outline" onClick={onClose}>Done</Button>
        </div>
      </div>
    </Modal>
  )
}
