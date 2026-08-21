"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Check } from "lucide-react"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { TruncatedText } from "@/components/ui/truncate-with-tooltip"
import { useModelCatalog, type ModelCatalogOption } from "@/hooks/use-model-catalog"
import { resolveCatalogDisplayName } from "@/lib/models/humanize"
import { providerLabel } from "@/lib/models/provider-labels"
import { providerFromModelRef } from "@/lib/supported-providers"
import {
  POWERED_BY_CLAWS_CREDITS,
  providerUnlockReason,
  resolveProviderAuth,
} from "@/lib/models/provider-auth"
import {
  THINKING_HELP_TEXT,
  THINKING_HELP_TEXT_UNKNOWN,
  THINKING_LEVELS,
  THINKING_LEVEL_LABEL,
  isThinkingLevel,
  thinkingUnsupportedText,
} from "@/lib/models/thinking"

/** Virtualization contract — tests assert the window stays small at 400+ rows. */
export const MODEL_MODAL_ROW_HEIGHT = 44
export const MODEL_MODAL_VIEWPORT = 264
export const MODEL_MODAL_OVERSCAN = 6

const PROVIDER_TABS = ["ANTHROPIC", "OPENAI", "GOOGLE", "OPENROUTER"] as const
type ProviderTab = (typeof PROVIDER_TABS)[number]

export interface ModelSelectModalProps {
  open: boolean
  onClose: () => void
  /** Current model ref; preselects its provider tab and row. */
  value: string
  thinkingDefault?: string | null
  onSave: (model: string, thinkingDefault: string | null) => void
  agentName?: string
  creditMode?: boolean
  configuredProviders?: string[]
  /** When provided, locked tabs render an "Add API key" action. */
  onAddKey?: (provider: string) => void
}

function formatContext(context: number | null): string | null {
  if (!context || context <= 0) return null
  if (context >= 1_000_000) {
    const m = context / 1_000_000
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M ctx`
  }
  if (context >= 1000) return `${Math.round(context / 1000)}K ctx`
  return `${context} ctx`
}

/** Row price honesty: real snippet or an em dash — never an invented number. */
function formatRowPrice(option: ModelCatalogOption): string {
  return option.pricingSnippet ?? "—"
}

function tabOf(providerKey: string): ProviderTab {
  return (PROVIDER_TABS as readonly string[]).includes(providerKey)
    ? (providerKey as ProviderTab)
    : "OPENROUTER"
}

export function ModelSelectModal({
  open,
  onClose,
  value,
  thinkingDefault = null,
  onSave,
  agentName,
  creditMode = false,
  configuredProviders = [],
  onAddKey,
}: ModelSelectModalProps) {
  const { options: catalog, loading } = useModelCatalog()

  const initialTab = tabOf(providerFromModelRef(value) ?? "ANTHROPIC")
  const [activeTab, setActiveTab] = useState<ProviderTab>(initialTab)
  const [query, setQuery] = useState("")
  const [pendingModel, setPendingModel] = useState(value)
  const [pendingThinking, setPendingThinking] = useState<string | null>(
    isThinkingLevel(thinkingDefault) ? thinkingDefault : null,
  )
  const [scrollTop, setScrollTop] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  // Re-arm from props each time the modal opens.
  useEffect(() => {
    if (!open) return
    setActiveTab(tabOf(providerFromModelRef(value) ?? "ANTHROPIC"))
    setQuery("")
    setPendingModel(value)
    setPendingThinking(isThinkingLevel(thinkingDefault) ? thinkingDefault : null)
    setScrollTop(0)
  }, [open, value, thinkingDefault])

  const byProvider = useMemo(() => {
    const map = new Map<ProviderTab, ModelCatalogOption[]>()
    for (const tab of PROVIDER_TABS) map.set(tab, [])
    for (const option of catalog) {
      map.get(tabOf(option.providerKey))?.push(option)
    }
    for (const tab of PROVIDER_TABS) {
      const list = map.get(tab)!
      list.sort((a, b) =>
        a.isPinned === b.isPinned ? a.label.localeCompare(b.label) : a.isPinned ? -1 : 1,
      )
    }
    return map
  }, [catalog])

  const activeAuth = resolveProviderAuth(activeTab, { creditMode, configuredProviders })

  const visibleRows = useMemo(() => {
    const list = byProvider.get(activeTab) ?? []
    const q = query.trim().toLowerCase()
    if (!q) return list
    return list.filter(
      (o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
    )
  }, [byProvider, activeTab, query])

  // Windowed rendering: only the visible slice mounts.
  const total = visibleRows.length
  const start = Math.max(0, Math.floor(scrollTop / MODEL_MODAL_ROW_HEIGHT) - MODEL_MODAL_OVERSCAN)
  const end = Math.min(
    total,
    Math.ceil((scrollTop + MODEL_MODAL_VIEWPORT) / MODEL_MODAL_ROW_HEIGHT) + MODEL_MODAL_OVERSCAN,
  )
  const windowRows = visibleRows.slice(start, end)

  const pendingOption = catalog.find((o) => o.value === pendingModel)
  const pendingLabel = pendingOption?.label ?? resolveCatalogDisplayName(pendingModel, null)
  const pendingProvider = providerFromModelRef(pendingModel)
  const pendingAuth = pendingProvider
    ? resolveProviderAuth(pendingProvider, { creditMode, configuredProviders })
    : null
  const canSave = Boolean(pendingModel) && (pendingAuth?.selectable ?? false)

  // Per-model thinking gate: false = control locked at Default; null = unknown,
  // control stays usable (the runtime ignores levels on non-reasoning models).
  // Deps include `open`: the re-arm effect above re-injects the stored level on
  // every open, so the reset must re-run even when reasoningLocked is unchanged.
  const reasoningLocked = pendingOption?.supportsReasoning === false
  useEffect(() => {
    if (reasoningLocked) setPendingThinking(null)
  }, [reasoningLocked, pendingModel, open])
  const thinkingHelp = reasoningLocked
    ? thinkingUnsupportedText(pendingLabel)
    : pendingOption?.supportsReasoning === true
      ? THINKING_HELP_TEXT
      : THINKING_HELP_TEXT_UNKNOWN

  const openRouterConfigured = configuredProviders.includes("OPENROUTER")

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title="Select model"
      description={agentName ? `Choose the AI model for ${agentName}.` : "Choose a provider, then a model."}
      footer={
        <>
          <div className="flex-1 min-w-0 self-center text-left">
            <TruncatedText className="block text-[11px] text-[var(--tx2)]">
              {`Selected: ${pendingLabel}${pendingProvider ? ` · ${providerLabel(pendingProvider)}` : ""}`}
            </TruncatedText>
          </div>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            data-testid="model-modal-save"
            onClick={() => {
              // Hard guard: never persist a thinking level for a model that
              // cannot reason, even if effect timing left stale UI state.
              onSave(pendingModel, reasoningLocked ? null : pendingThinking)
              onClose()
            }}
            disabled={!canSave}
            title={canSave ? undefined : "This model's provider has no API key yet"}
          >
            Use this model
          </Button>
        </>
      }
    >
      {/* Provider tabs (DS Tabs spec: 12px, 2px active underline) */}
      <div className="flex border-b border-[var(--bd)] -mx-5 px-5" role="tablist" aria-label="Model provider">
        {PROVIDER_TABS.map((tab) => {
          const auth = resolveProviderAuth(tab, { creditMode, configuredProviders })
          const active = tab === activeTab
          return (
            <button
              key={tab}
              role="tab"
              aria-selected={active}
              data-testid={`model-modal-tab-${tab}`}
              onClick={() => {
                setActiveTab(tab)
                setQuery("")
                setScrollTop(0)
                if (listRef.current) listRef.current.scrollTop = 0
              }}
              className={`px-[14px] py-[8px] text-[12px] border-b-2 -mb-px cursor-pointer bg-transparent transition-colors ${
                active
                  ? "border-[var(--tx)] text-[var(--tx)] font-medium"
                  : "border-transparent text-[var(--tx2)] hover:text-[var(--tx)]"
              }`}
            >
              <span className="flex items-center gap-[6px]">
                {providerLabel(tab)}
                <span
                  aria-hidden
                  className={`inline-block w-[7px] h-[7px] rounded-full ${
                    auth.selectable ? "bg-[var(--ok)]" : "bg-[var(--tx3)]"
                  }`}
                />
              </span>
            </button>
          )
        })}
      </div>

      {/* Auth status line for the active provider */}
      <div className="mt-[10px]">
        {activeAuth.kind === "credits" ? (
          <p data-testid="model-modal-auth-line" className="text-[11px] text-[var(--ok)]">
            {POWERED_BY_CLAWS_CREDITS} — every model below is ready to use.
          </p>
        ) : activeAuth.kind === "key" ? (
          <p data-testid="model-modal-auth-line" className="text-[11px] text-[var(--ok)]">
            {providerLabel(activeTab)} API key connected — every model below is ready to use.
          </p>
        ) : (
          <div
            data-testid="model-modal-locked-banner"
            className="rounded-[8px] border border-[var(--bd)] bg-[var(--bg2)] px-[10px] py-[8px]"
          >
            <div className="flex items-center justify-between gap-[10px]">
              <p className="text-[11px] text-[var(--tx2)]">{activeAuth.unlockReason}</p>
              {onAddKey && (
                <Button size="sm" onClick={() => onAddKey(activeTab)}>
                  Add API key
                </Button>
              )}
            </div>
            {openRouterConfigured && activeTab !== "OPENROUTER" && (
              <p className="text-[10px] text-[var(--tx3)] mt-[4px]">
                Tip: your OpenRouter key already runs {providerLabel(activeTab)} models — check the OpenRouter tab.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Search within the active provider */}
      <input
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value)
          setScrollTop(0)
          if (listRef.current) listRef.current.scrollTop = 0
        }}
        placeholder={`Search ${providerLabel(activeTab)} models…`}
        aria-label={`Search ${providerLabel(activeTab)} models`}
        data-testid="model-modal-search"
        className="mt-[10px] w-full h-[30px] px-[8px] rounded-[8px] border border-[var(--bd)] bg-[var(--bg)] text-[11px] text-[var(--tx)] outline-none focus:ring-2 focus:ring-[var(--ac)]/30"
      />

      {/* Virtualized model list */}
      <div
        ref={listRef}
        role="listbox"
        aria-label={`${providerLabel(activeTab)} models`}
        data-testid="model-modal-list"
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        className="mt-[8px] overflow-y-auto rounded-[8px] border border-[var(--bd)]"
        style={{ height: MODEL_MODAL_VIEWPORT }}
      >
        {total === 0 ? (
          <p className="px-[10px] py-[12px] text-[11px] text-[var(--tx3)]">
            {loading
              ? "Loading catalog…"
              : query
                ? `No ${providerLabel(activeTab)} models match “${query}”.`
                : `No ${providerLabel(activeTab)} models in the catalog yet — it refreshes daily.`}
          </p>
        ) : (
          <div className="relative" style={{ height: total * MODEL_MODAL_ROW_HEIGHT }}>
            {windowRows.map((option, i) => {
              const index = start + i
              const selected = option.value === pendingModel
              const locked = !activeAuth.selectable
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  disabled={locked}
                  data-testid={`model-modal-row-${option.value}`}
                  onClick={() => setPendingModel(option.value)}
                  className={`absolute left-0 right-0 flex items-center justify-between gap-[10px] px-[10px] text-left cursor-pointer border-none ${
                    selected ? "bg-[var(--bg2)]" : "bg-transparent hover:bg-[var(--acbg)]"
                  } ${locked ? "opacity-50 cursor-not-allowed" : ""}`}
                  style={{ top: index * MODEL_MODAL_ROW_HEIGHT, height: MODEL_MODAL_ROW_HEIGHT }}
                >
                  <span className="min-w-0 flex items-center gap-[6px]">
                    <span className={`w-[14px] shrink-0 ${selected ? "text-[var(--tx)]" : "text-transparent"}`}>
                      <Check className="w-[13px] h-[13px]" aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-[6px] min-w-0">
                        <TruncatedText className={`block text-[12px] leading-[16px] ${selected ? "font-semibold" : "font-medium"} text-[var(--tx)]`}>
                          {option.label}
                        </TruncatedText>
                        {option.supportsReasoning === true && (
                          <span
                            data-testid={`model-reasoning-chip-${option.value}`}
                            className="shrink-0 text-[9px] leading-[13px] px-[5px] rounded-[5px] bg-[var(--acbg)] text-[var(--ac-text)]"
                          >
                            Reasoning
                          </span>
                        )}
                      </span>
                      <span className="block text-[10px] leading-[13px] text-[var(--tx3)]">
                        {option.isPinned ? "Recommended" : option.value}
                      </span>
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-[10px] leading-[13px] text-[var(--tx3)]">
                    {formatContext(option.contextLength) && (
                      <span className="block">{formatContext(option.contextLength)}</span>
                    )}
                    <span className="block">{formatRowPrice(option)}</span>
                  </span>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Thinking effort */}
      <div className="mt-[12px]">
        <div className="text-[11px] font-semibold text-[var(--tx)] mb-[6px]">Thinking effort</div>
        <div className="inline-flex rounded-[8px] border border-[var(--bd)] overflow-hidden" role="radiogroup" aria-label="Thinking effort">
          <button
            type="button"
            role="radio"
            aria-checked={pendingThinking === null}
            data-testid="thinking-level-default"
            onClick={() => setPendingThinking(null)}
            className={`px-[10px] py-[4px] text-[11px] cursor-pointer border-none border-r border-[var(--bd)] ${
              pendingThinking === null ? "bg-[var(--tx)] text-white font-medium" : "bg-transparent text-[var(--tx2)] hover:bg-[var(--bg2)]"
            }`}
          >
            Default
          </button>
          {THINKING_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              role="radio"
              aria-checked={pendingThinking === level}
              data-testid={`thinking-level-${level}`}
              disabled={reasoningLocked}
              onClick={() => setPendingThinking(level)}
              className={`px-[10px] py-[4px] text-[11px] border-none ${
                pendingThinking === level
                  ? "bg-[var(--tx)] text-white font-medium"
                  : `bg-transparent text-[var(--tx2)]${reasoningLocked ? "" : " hover:bg-[var(--bg2)]"}`
              } ${reasoningLocked ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}`}
            >
              {THINKING_LEVEL_LABEL[level]}
            </button>
          ))}
        </div>
        <p data-testid="thinking-help" className="text-[10px] text-[var(--tx3)] mt-[5px]">
          {thinkingHelp}
        </p>
      </div>
    </Modal>
  )
}
