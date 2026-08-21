import { providerFromModelRef, type SupportedProvider } from "@/lib/supported-providers"
import { providerLabel } from "@/lib/models/provider-labels"

export const POWERED_BY_CLAWS_CREDITS = "Powered by Claws credits"
/**
 * Human copy ruling (founder, post-picker-rebuild): never render auth jargon.
 * "No auth path" is dead. A missing key reads "No API key"; Anthropic with
 * neither credits nor key reads "No credits or API key". Credits are automatic
 * when active — copy must never ask the user to "use" them.
 */
export const NO_KEY_LABEL = "No API key"
export const ANTHROPIC_NO_AUTH_LABEL = "No credits or API key"

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

/** Shown on a locked provider section in the model modal. Plain instruction, no jargon. */
export function providerUnlockReason(provider: string): string {
  const pretty = providerLabel(provider)
  return `Add ${articleFor(pretty)} ${pretty} API key to unlock these models`
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
      cardLabel: ANTHROPIC_NO_AUTH_LABEL,
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
 * Row warning for a selected model with no auth path. Human copy:
 * Anthropic explains why credits are not covering it; others just name the key.
 */
export function modelDeployWarning(
  modelId: string,
  opts: { creditMode: boolean; configuredProviders: readonly string[] },
): string | null {
  const provider = providerFromModelRef(modelId)
  if (!provider) return null
  const auth = resolveProviderAuth(provider, opts)
  if (auth.selectable) return null
  const pretty = providerLabel(provider)
  if (auth.cardState === "no-auth-path") {
    return `No active credits on this account — add an Anthropic API key before deploy`
  }
  return `Add ${articleFor(pretty)} ${pretty} API key before deploy`
}

export function providerFromRefOrNull(modelId: string): SupportedProvider | null {
  return providerFromModelRef(modelId)
}
