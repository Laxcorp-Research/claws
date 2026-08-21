import { providerFromModelRef, type SupportedProvider } from "@/lib/supported-providers"
import { providerLabel } from "@/lib/models/provider-labels"

export const POWERED_BY_CLAWS_CREDITS = "Powered by Claws credits"
export const NO_KEY_LABEL = "No key"
export const NO_AUTH_PATH_LABEL = "No auth path"

export type CreditBalanceSlice = {
  hasCredits?: boolean
  status?: string | null
}

/** Credits are an Anthropic auth path while the account is ACTIVE or EXHAUSTED. */
export function isCreditAuthPath(balance: CreditBalanceSlice | null | undefined): boolean {
  if (!balance?.hasCredits) return false
  return balance.status === "ACTIVE" || balance.status === "EXHAUSTED"
}

export type ProviderKeySlice = {
  provider: string
  effectiveSource: "override" | "global" | "none" | string
  overrideKeyValid: boolean
  globalKeyValid: boolean
}

export function validConfiguredProviders(keyStatus: readonly ProviderKeySlice[]): string[] {
  return keyStatus
    .filter((k) => (k.effectiveSource === "override" ? k.overrideKeyValid : k.globalKeyValid))
    .map((k) => k.provider)
}

export type ProviderAuthKind = "credits" | "key" | "none"

export type ProviderCardState = "credits" | "key" | "no-key" | "no-auth-path"

export type ProviderAuth = {
  selectable: boolean
  kind: ProviderAuthKind
  unlockReason: string | null
  cardState: ProviderCardState
  cardLabel: string
}

function articleFor(name: string): "a" | "an" {
  return /^[aeiou]/i.test(name) ? "an" : "a"
}

export function providerUnlockReason(provider: string): string {
  if (provider === "ANTHROPIC") return "Add an Anthropic key or use Claws credits"
  const pretty = providerLabel(provider)
  return `Add ${articleFor(pretty)} ${pretty} key`
}

export function resolveProviderAuth(
  provider: string,
  opts: { creditMode: boolean; configuredProviders: readonly string[] },
): ProviderAuth {
  const hasKey = opts.configuredProviders.includes(provider)
  if (hasKey) {
    return {
      selectable: true,
      kind: "key",
      unlockReason: null,
      cardState: "key",
      cardLabel: "",
    }
  }
  if (provider === "ANTHROPIC" && opts.creditMode) {
    return {
      selectable: true,
      kind: "credits",
      unlockReason: null,
      cardState: "credits",
      cardLabel: POWERED_BY_CLAWS_CREDITS,
    }
  }
  if (provider === "ANTHROPIC") {
    return {
      selectable: false,
      kind: "none",
      unlockReason: providerUnlockReason(provider),
      cardState: "no-auth-path",
      cardLabel: NO_AUTH_PATH_LABEL,
    }
  }
  return {
    selectable: false,
    kind: "none",
    unlockReason: providerUnlockReason(provider),
    cardState: "no-key",
    cardLabel: NO_KEY_LABEL,
  }
}

export function isModelSelectable(
  modelId: string,
  opts: { creditMode: boolean; configuredProviders: readonly string[] },
): boolean {
  const provider = providerFromModelRef(modelId)
  if (!provider) return false
  return resolveProviderAuth(provider, opts).selectable
}

/**
 * Row warning for a selected model with no auth path.
 * Distinguishes "no auth path" (neither credits nor key) from "no key typed".
 */
export function modelDeployWarning(
  modelId: string,
  opts: { creditMode: boolean; configuredProviders: readonly string[] },
): string | null {
  const provider = providerFromModelRef(modelId)
  if (!provider) return null
  const auth = resolveProviderAuth(provider, opts)
  if (auth.selectable) return null
  if (auth.cardState === "no-auth-path") {
    return "No auth path for Anthropic — add a key or use Claws credits"
  }
  const pretty = providerLabel(provider)
  return `Needs ${articleFor(pretty)} ${pretty} key before deploy`
}

export function providerFromRefOrNull(modelId: string): SupportedProvider | null {
  return providerFromModelRef(modelId)
}
