"use client"

import { useState } from "react"
import { TruncatedText } from "@/components/ui/truncate-with-tooltip"
import { ModelSelectModal } from "@/components/shared/model-select-modal"
import { useModelCatalog } from "@/hooks/use-model-catalog"
import { resolveCatalogDisplayName } from "@/lib/models/humanize"
import { modelDeployWarning } from "@/lib/models/provider-auth"
import { providerLabel } from "@/lib/models/provider-labels"
import { providerFromModelRef } from "@/lib/supported-providers"
import { THINKING_LEVEL_LABEL, isThinkingLevel } from "@/lib/models/thinking"

interface ModelPickerProps {
  value: string
  thinkingDefault?: string | null
  onChange: (model: string, thinkingDefault: string | null) => void
  creditMode?: boolean
  /** Providers with a valid key. Credits unlock Anthropic even when empty. */
  configuredProviders?: string[]
  agentName?: string
  /** Wire to the provider key modal so locked tabs can offer "Add API key". */
  onAddKey?: (provider: string) => void
}

/**
 * ONE model control per agent: a "Select model" button that opens the
 * provider/model modal. Closed state renders the DISPLAY NAME + provider tag —
 * never a raw slug.
 * MUTATION: restore a hardcoded native option array here → picker tests fail.
 * MUTATION: restore an inline dropdown or a second catalog search field
 * outside the modal → picker tests fail.
 */
export function ModelPicker({
  value,
  thinkingDefault = null,
  onChange,
  creditMode = false,
  configuredProviders = [],
  agentName,
  onAddKey,
}: ModelPickerProps) {
  const { options: catalog } = useModelCatalog()
  const [open, setOpen] = useState(false)

  const selected = catalog.find((o) => o.value === value)
  const triggerLabel = selected?.label ?? resolveCatalogDisplayName(value, null)
  const triggerProvider = selected?.providerKey ?? providerFromModelRef(value)
  const triggerTag = triggerProvider ? providerLabel(triggerProvider) : selected?.provider
  const warning = modelDeployWarning(value, { creditMode, configuredProviders })
  const thinkingTag = isThinkingLevel(thinkingDefault)
    ? THINKING_LEVEL_LABEL[thinkingDefault]
    : null

  return (
    <div className="space-y-1">
      <button
        type="button"
        data-testid="model-picker-trigger"
        aria-haspopup="dialog"
        aria-label={value ? `Model: ${triggerLabel}. Change model` : "Select model"}
        onClick={() => setOpen(true)}
        className="w-full min-h-[30px] px-[8px] py-[4px] flex items-center justify-between gap-[8px] rounded-[8px] border border-[var(--bd)] bg-[var(--bg)] text-left cursor-pointer hover:border-[var(--tx3)] focus:outline-none focus:ring-2 focus:ring-[var(--ac)]/30 transition-colors"
      >
        {value ? (
          <>
            <span className="min-w-0 flex items-center gap-[6px]">
              <TruncatedText className="block text-[11px] font-medium text-[var(--tx)]">
                {triggerLabel}
              </TruncatedText>
              {thinkingTag && (
                <span className="shrink-0 text-[10px] px-[6px] py-[1px] rounded-[6px] bg-[var(--acbg)] text-[var(--ac-text)]">
                  Thinking: {thinkingTag}
                </span>
              )}
            </span>
            <span className="shrink-0 flex items-center gap-[6px]">
              {triggerTag && (
                <span className="text-[10px] px-[6px] py-[1px] rounded-[6px] bg-[var(--bg2)] text-[var(--tx2)]">
                  {triggerTag}
                </span>
              )}
              <span className="text-[10px] font-medium text-[var(--ac-text)]">Change</span>
            </span>
          </>
        ) : (
          <span className="text-[11px] text-[var(--tx2)]">Select model…</span>
        )}
      </button>
      {warning ? (
        <p data-testid="model-auth-warning" className="text-[10px] text-[var(--warn)]">
          {warning}
        </p>
      ) : null}
      <ModelSelectModal
        open={open}
        onClose={() => setOpen(false)}
        value={value}
        thinkingDefault={thinkingDefault}
        onSave={onChange}
        agentName={agentName}
        creditMode={creditMode}
        configuredProviders={configuredProviders}
        onAddKey={onAddKey}
      />
    </div>
  )
}
