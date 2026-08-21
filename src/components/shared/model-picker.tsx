"use client"

import { useState } from "react"
import { TruncatedText } from "@/components/ui/truncate-with-tooltip"
import { ModelSelectModal } from "@/components/shared/model-select-modal"
import { useModelCatalog } from "@/hooks/use-model-catalog"
import { resolveCatalogDisplayName } from "@/lib/models/humanize"
import { modelDeployWarning } from "@/lib/models/provider-auth"

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
 * ONE model control per agent: a button that opens the provider/model modal.
 * Closed state renders ONLY the selected model's DISPLAY NAME (never a raw
 * slug, never a provider tag) plus the Change affordance; empty state reads
 * "Select a model". Provider/thinking detail lives in the modal.
 * MUTATION: restore a hardcoded native option array here → picker tests fail.
 * MUTATION: restore an inline dropdown or a second catalog search field
 * outside the modal → picker tests fail.
 * MUTATION: render a provider tag on the closed trigger → picker tests fail.
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
  const warning = modelDeployWarning(value, { creditMode, configuredProviders })

  return (
    <div className="space-y-1">
      <button
        type="button"
        data-testid="model-picker-trigger"
        aria-haspopup="dialog"
        aria-label={value ? `Model: ${triggerLabel}. Change model` : "Select a model"}
        onClick={() => setOpen(true)}
        className="w-full min-h-[30px] px-[8px] py-[4px] flex items-center justify-between gap-[8px] rounded-[8px] border border-[var(--bd)] bg-[var(--bg)] text-left cursor-pointer hover:border-[var(--tx3)] focus:outline-none focus:ring-2 focus:ring-[var(--ac)]/30 transition-colors"
      >
        {value ? (
          <>
            <TruncatedText className="block min-w-0 text-[11px] font-medium text-[var(--tx)]">
              {triggerLabel}
            </TruncatedText>
            <span className="shrink-0 text-[10px] font-medium text-[var(--ac-text)]">Change</span>
          </>
        ) : (
          <span className="text-[11px] text-[var(--tx2)]">Select a model</span>
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
