/**
 * PR-0 marketplace rider: honesty labels for channels / BYOK providers.
 * Telegram + Anthropic remain the proven defaults (no beta badge).
 */

export const CHANNEL_BETA_LABEL = "beta"
export const PROVIDER_BYOK_BETA_LABEL = "beta — bring your own key"

/** Launch channels that are connectable but not yet the proven default. */
export const CHANNELS_WITH_BETA = ["discord", "slack"] as const

/** BYOK providers that are supported but labeled beta. */
export const PROVIDERS_WITH_BYOK_BETA = ["OPENAI", "GOOGLE"] as const

export type BetaChannelId = (typeof CHANNELS_WITH_BETA)[number]
export type ByokBetaProvider = (typeof PROVIDERS_WITH_BYOK_BETA)[number]

export function isBetaChannel(channelId: string): channelId is BetaChannelId {
  return (CHANNELS_WITH_BETA as readonly string[]).includes(channelId)
}

export function isByokBetaProvider(provider: string): provider is ByokBetaProvider {
  return (PROVIDERS_WITH_BYOK_BETA as readonly string[]).includes(provider)
}
