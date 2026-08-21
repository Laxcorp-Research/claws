"use client"

import { useMemo } from "react"
import { Combobox, type ComboboxGroup, type ComboboxItem } from "@/components/ui/combobox"
import { useModelCatalog, type ModelCatalogOption } from "@/hooks/use-model-catalog"
import { resolveCatalogDisplayName } from "@/lib/models/humanize"
import {
  modelDeployWarning,
  resolveProviderAuth,
} from "@/lib/models/provider-auth"
import { providerLabel } from "@/lib/models/provider-labels"
import { providerFromModelRef } from "@/lib/supported-providers"

const PROVIDER_ORDER = ["ANTHROPIC", "OPENAI", "GOOGLE", "OPENROUTER"] as const

interface ModelPickerProps {
  value: string
  onChange: (value: string) => void
  creditMode?: boolean
  /** Providers with a valid key. Credits unlock Anthropic even when empty. */
  configuredProviders?: string[]
}

function toItem(
  option: ModelCatalogOption,
  creditMode: boolean,
  configuredProviders: readonly string[],
): ComboboxItem {
  const auth = resolveProviderAuth(option.providerKey, { creditMode, configuredProviders })
  return {
    value: option.value,
    label: option.label,
    tag: option.provider,
    disabled: !auth.selectable,
    hint: auth.unlockReason ?? undefined,
    keywords: option.value,
  }
}

function buildGroups(
  options: ModelCatalogOption[],
  creditMode: boolean,
  configuredProviders: readonly string[],
): ComboboxGroup[] {
  const groups: ComboboxGroup[] = []
  const pinned = options.filter((o) => o.isPinned)
  if (pinned.length > 0) {
    groups.push({
      heading: "Recommended",
      items: pinned.map((o) => toItem(o, creditMode, configuredProviders)),
    })
  }
  const rest = options.filter((o) => !o.isPinned)
  const by = new Map<string, ModelCatalogOption[]>()
  for (const option of rest) {
    const list = by.get(option.providerKey) ?? []
    list.push(option)
    by.set(option.providerKey, list)
  }
  const extra = [...by.keys()].filter((k) => !(PROVIDER_ORDER as readonly string[]).includes(k)).sort()
  const keys = [...PROVIDER_ORDER.filter((k) => by.has(k)), ...extra]
  for (const key of keys) {
    const list = by.get(key)
    if (!list?.length) continue
    groups.push({
      heading: list[0]?.provider ?? providerLabel(key),
      items: list.map((o) => toItem(o, creditMode, configuredProviders)),
    })
  }
  return groups
}

/**
 * Options come from GET /api/models/catalog (ModelCatalogEntry registry).
 * MUTATION: restore a hardcoded native option array here → picker tests fail.
 * MUTATION: restore a second catalog search field beside this combobox → picker tests fail.
 */
export function ModelPicker({
  value,
  onChange,
  creditMode = false,
  configuredProviders = [],
}: ModelPickerProps) {
  const { options: catalog } = useModelCatalog()

  const options = useMemo(() => {
    const list = [...catalog]
    if (value && !list.some((o) => o.value === value)) {
      const key = providerFromModelRef(value) ?? "ANTHROPIC"
      list.unshift({
        value,
        label: resolveCatalogDisplayName(value, null),
        provider: providerLabel(key),
        providerKey: key,
        isPinned: false,
      })
    }
    return list
  }, [catalog, value])

  const groups = useMemo(
    () => buildGroups(options, creditMode, configuredProviders),
    [options, creditMode, configuredProviders],
  )

  const selected = options.find((o) => o.value === value)
  const triggerLabel = selected?.label ?? resolveCatalogDisplayName(value, null)
  const triggerProvider = selected?.providerKey ?? providerFromModelRef(value)
  const triggerTag = triggerProvider ? providerLabel(triggerProvider) : selected?.provider
  const warning = modelDeployWarning(value, { creditMode, configuredProviders })

  return (
    <div className="space-y-1">
      <Combobox
        value={value}
        onChange={onChange}
        triggerLabel={triggerLabel}
        triggerTag={triggerTag}
        groups={groups}
      />
      {warning ? (
        <p data-testid="model-auth-warning" className="text-[10px] text-[var(--warn)]">
          {warning}
        </p>
      ) : null}
    </div>
  )
}
