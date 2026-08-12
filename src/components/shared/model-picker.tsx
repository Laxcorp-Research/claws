"use client"

import { useCallback, useEffect, useState } from "react"
import { CustomSelect } from "@/components/ui/custom-select"
import { Input } from "@/components/ui/input"
import { TruncatedText } from "@/components/ui/truncate-with-tooltip"

type Option = { value: string; label: string }

interface ModelPickerProps {
  value: string
  onChange: (value: string) => void
  creditMode?: boolean
  /** Providers the user has keys for — used for honesty hint only (selection still allowed). */
  configuredProviders?: string[]
}

/**
 * Pinned/recommended first via CustomSelect; full catalog behind search
 * (never a 400-item flat dropdown).
 */
export function ModelPicker({
  value,
  onChange,
  creditMode = false,
  configuredProviders,
}: ModelPickerProps) {
  const [pinnedOptions, setPinnedOptions] = useState<Option[]>([])
  const [search, setSearch] = useState("")
  const [searchOptions, setSearchOptions] = useState<Option[]>([])
  const [searching, setSearching] = useState(false)
  const [honesty, setHonesty] = useState<string | null>(null)

  const loadPinned = useCallback(async () => {
    const params = new URLSearchParams({ pinned: "1", limit: "40" })
    if (creditMode) params.set("creditMode", "1")
    const res = await fetch(`/api/models/catalog?${params}`)
    const json = await res.json()
    const d = json.data ?? json
    const opts: Option[] = (d.options ?? []).map((o: { value: string; label: string; provider?: string }) => ({
      value: o.value,
      label: o.provider ? `${o.label} (${o.provider})` : o.label,
    }))
    // Ensure current value appears even if not pinned
    if (value && !opts.some((o) => o.value === value)) {
      opts.unshift({ value, label: value })
    }
    setPinnedOptions(opts)
    if (typeof d.honesty === "string") setHonesty(d.honesty)
  }, [creditMode, value])

  useEffect(() => {
    void loadPinned()
  }, [loadPinned])

  useEffect(() => {
    if (!search.trim() || creditMode) {
      setSearchOptions([])
      return
    }
    const t = setTimeout(async () => {
      setSearching(true)
      try {
        const params = new URLSearchParams({ q: search.trim(), limit: "30" })
        const res = await fetch(`/api/models/catalog?${params}`)
        const json = await res.json()
        const d = json.data ?? json
        setSearchOptions(
          (d.options ?? []).map((o: { value: string; label: string; provider?: string }) => ({
            value: o.value,
            label: o.provider ? `${o.label} (${o.provider})` : o.label,
          })),
        )
      } finally {
        setSearching(false)
      }
    }, 250)
    return () => clearTimeout(t)
  }, [search, creditMode])

  const missingKeyHint = (() => {
    if (!configuredProviders || creditMode) return null
    const prefix = value.startsWith("openrouter/")
      ? "OPENROUTER"
      : value.startsWith("anthropic/")
        ? "ANTHROPIC"
        : value.startsWith("openai/")
          ? "OPENAI"
          : value.startsWith("google/")
            ? "GOOGLE"
            : null
    if (!prefix) return null
    if (configuredProviders.includes(prefix)) return null
    return `Needs a ${prefix} key before deploy`
  })()

  const byokOpenRouter = value.startsWith("openrouter/")

  return (
    <div className="space-y-1.5">
      <CustomSelect
        value={value}
        onChange={onChange}
        options={pinnedOptions.length ? pinnedOptions : [{ value, label: value || "Select model" }]}
      />
      {!creditMode && (
        <div>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search full catalog (OpenRouter + natives)…"
            className="text-[11px]"
          />
          {searching && <p className="text-[10px] text-[var(--tx3)] mt-1">Searching…</p>}
          {searchOptions.length > 0 && (
            <ul className="mt-1 max-h-[160px] overflow-y-auto border border-[var(--bd)] rounded-[6px] bg-[var(--bg)]">
              {searchOptions.map((o) => (
                <li key={o.value}>
                  <button
                    type="button"
                    className="w-full text-left px-2 py-1.5 text-[11px] text-[var(--tx)] hover:bg-[var(--bg2)]"
                    onClick={() => {
                      onChange(o.value)
                      setSearch("")
                      setSearchOptions([])
                    }}
                  >
                    {o.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {byokOpenRouter && (
        <p className="text-[10px] text-[var(--tx2)]">
          OpenRouter — BYOK only · estimate-only cost · billed by OpenRouter
        </p>
      )}
      {missingKeyHint && (
        <p className="text-[10px] text-[var(--warn)]">{missingKeyHint}</p>
      )}
      {honesty && !byokOpenRouter && (
        <p className="text-[10px] text-[var(--tx3)]">
          <TruncatedText>{honesty}</TruncatedText>
        </p>
      )}
    </div>
  )
}
