"use client"

import { AlertTriangle, CheckCircle, XCircle } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import {
  ANTHROPIC_NO_AUTH_LABEL,
  NO_KEY_LABEL,
  POWERED_BY_CLAWS_CREDITS,
  resolveProviderAuth,
} from "@/lib/models/provider-auth"
import { SUPPORTED_PROVIDERS } from "@/lib/supported-providers"
import { PROVIDER_BYOK_BETA_LABEL, isByokBetaProvider } from "@/lib/ui/beta-labels"

export type ProviderKeyStatus = {
  provider: string
  hasGlobalKey: boolean
  globalKeyHint: string | null
  globalKeyValid: boolean
  hasOverride: boolean
  overrideKeyHint: string | null
  overrideKeyValid: boolean
  hasKey: boolean
  effectiveSource: "override" | "global" | "none"
}

export const PROVIDER_CARD_NAMES: Record<string, string> = {
  ANTHROPIC: "Anthropic (Claude)",
  OPENAI: "OpenAI (GPT)",
  GOOGLE: "Google (Gemini)",
  OPENROUTER: "OpenRouter - one key, every model",
}

interface AgentRef {
  name: string
  model: string
}

interface ProviderAuthCardsProps {
  agents: AgentRef[]
  keyStatus: ProviderKeyStatus[]
  creditMode: boolean
  configuredProviders: string[]
  onEnterKey: (provider: string, providerName: string) => void
  onChangeKey: (provider: string, providerName: string) => void
  onUseGlobal: (provider: string) => void
}

export function ProviderAuthCards({
  agents,
  keyStatus,
  creditMode,
  configuredProviders,
  onEnterKey,
  onChangeKey,
  onUseGlobal,
}: ProviderAuthCardsProps) {
  return (
    <div className="border border-[var(--bd)] rounded-xl mb-3.5 overflow-hidden">
      {SUPPORTED_PROVIDERS.map((provider) => {
        const status = keyStatus.find((k) => k.provider === provider)
        const providerName = PROVIDER_CARD_NAMES[provider] || provider
        const usingAgents = agents.filter((a) => {
          const m = a.model || ""
          return m.startsWith(`${provider.toLowerCase()}/`)
        })
        const auth = resolveProviderAuth(provider, { creditMode, configuredProviders })
        const keyLooksValid = Boolean(
          status?.hasKey &&
            (status.effectiveSource === "override" ? status.overrideKeyValid : status.globalKeyValid),
        )
        const keyLooksInvalid = Boolean(status?.hasKey && !keyLooksValid)

        return (
          <div
            key={provider}
            data-testid={`provider-auth-card-${provider}`}
            className="flex items-start justify-between gap-[24px] px-3.5 py-[10px] border-b border-[var(--bd)] last:border-b-0"
          >
            <div className="min-w-0 max-w-[60%]">
              <div className="flex items-center gap-1.5 flex-wrap">
                <div className="text-[13px] font-medium text-[var(--tx)]">{providerName}</div>
                {provider === "ANTHROPIC" && <Badge variant="success">default</Badge>}
                {isByokBetaProvider(provider) && (
                  <Badge variant="warning" title="Supported with your own API key; not the proven default.">
                    {PROVIDER_BYOK_BETA_LABEL}
                  </Badge>
                )}
              </div>
              {usingAgents.length > 0 && (
                <div className="text-[11px] text-[var(--tx3)] mt-[2px]">
                  Used by: {usingAgents.map((a) => a.name).join(", ")}
                </div>
              )}
            </div>
            <div className="flex items-center gap-[8px] flex-shrink-0 whitespace-nowrap">
              {keyLooksValid && status ? (
                <>
                  <div className="flex items-center gap-[4px]">
                    <CheckCircle className="w-[14px] h-[14px] text-[var(--ok)]" />
                    <span className="text-[11px] text-[var(--ok)]">
                      {status.effectiveSource === "override"
                        ? `Custom key (${status.overrideKeyHint})`
                        : `Global key (${status.globalKeyHint})`}
                    </span>
                  </div>
                  <button
                    onClick={() => onChangeKey(provider, providerName)}
                    className="text-[11px] text-[var(--ac-text)] hover:underline cursor-pointer bg-transparent border-none"
                  >
                    {status.hasOverride ? "Change key" : "Use different key"}
                  </button>
                  {status.hasOverride && (
                    <button
                      onClick={() => onUseGlobal(provider)}
                      className="text-[11px] text-[var(--tx3)] hover:text-[var(--err)] cursor-pointer bg-transparent border-none"
                    >
                      Use global
                    </button>
                  )}
                </>
              ) : keyLooksInvalid && status ? (
                <>
                  <div className="flex items-center gap-[4px]">
                    <AlertTriangle className="w-[14px] h-[14px] text-[var(--warn)]" />
                    <span className="text-[11px] text-[var(--warn)]">
                      {status.effectiveSource === "override"
                        ? `Custom key invalid (${status.overrideKeyHint})`
                        : `Global key invalid (${status.globalKeyHint})`}
                    </span>
                  </div>
                  <button
                    onClick={() => onChangeKey(provider, providerName)}
                    className="text-[11px] text-[var(--ac-text)] hover:underline cursor-pointer bg-transparent border-none"
                  >
                    {status.hasOverride ? "Change key" : "Use different key"}
                  </button>
                </>
              ) : auth.cardState === "credits" ? (
                <>
                  <div className="flex items-center gap-[4px]" data-testid="provider-auth-credits">
                    <CheckCircle className="w-[14px] h-[14px] text-[var(--ok)]" />
                    <span className="text-[11px] text-[var(--ok)]">{POWERED_BY_CLAWS_CREDITS}</span>
                  </div>
                  <button
                    onClick={() => onEnterKey(provider, providerName)}
                    className="text-[11px] text-[var(--ac-text)] hover:underline cursor-pointer bg-transparent border-none"
                  >
                    Add your own key
                  </button>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-[4px]">
                    <XCircle className="w-[14px] h-[14px] text-[var(--err)]" />
                    <span
                      data-testid={`provider-auth-missing-${provider}`}
                      className="text-[11px] text-[var(--err)]"
                    >
                      {auth.cardState === "no-auth-path" ? ANTHROPIC_NO_AUTH_LABEL : NO_KEY_LABEL}
                    </span>
                  </div>
                  <button
                    onClick={() => onEnterKey(provider, providerName)}
                    className="text-[10px] px-2.5 py-[3px] rounded-md bg-[var(--tx)] text-white hover:opacity-90 transition-opacity cursor-pointer border-none"
                  >
                    Enter API key
                  </button>
                </>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
