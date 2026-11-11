import { prisma } from "@/lib/db"
import { decrypt } from "@/lib/encryption"
import { SUPPORTED_PROVIDERS, type SupportedProvider } from "@/lib/supported-providers"

/**
 * One map for model-provider secrets. WorkspaceApiKey (wizard / custom)
 * overrides UserApiKey (account default). September 2026 (D6 webchat-silent)
 * applied this to OpenAI, Google, and OpenRouter only. Anthropic stayed on
 * the account row because hosted credit mode also injects a key through
 * deriveContainerEnv. Self-host never takes that path: the wizard writes
 * WorkspaceApiKey and the container reads the generator .env.
 */
export const PROVIDER_ENV_NAMES: Record<SupportedProvider, string> = {
  ANTHROPIC: "ANTHROPIC_API_KEY",
  OPENAI: "OPENAI_API_KEY",
  GOOGLE: "GEMINI_API_KEY",
  OPENROUTER: "OPENROUTER_API_KEY",
}

export type ProviderKeyMap = Partial<Record<SupportedProvider, string>>

export function resolveProviderKeyMap(args: {
  overrides: ReadonlyArray<{ provider: string; encryptedKey: string | null }>
  userKeys: ReadonlyArray<{ provider: string; encryptedKey: string | null }>
}): ProviderKeyMap {
  const overrides = args.overrides ?? []
  const userKeys = args.userKeys ?? []
  const map: ProviderKeyMap = {}
  for (const provider of SUPPORTED_PROVIDERS) {
    const row =
      overrides.find((key) => key.provider === provider && key.encryptedKey) ??
      userKeys.find((key) => key.provider === provider && key.encryptedKey)
    if (!row?.encryptedKey) continue
    map[provider] = decrypt(row.encryptedKey)
  }
  return map
}

export async function resolveProviderKeys(workspaceId: string): Promise<ProviderKeyMap> {
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: {
      apiKeyOverrides: { select: { provider: true, encryptedKey: true } },
      user: { select: { apiKeys: { select: { provider: true, encryptedKey: true } } } },
    },
  })
  return resolveProviderKeyMap({
    overrides: workspace.apiKeyOverrides ?? [],
    userKeys: workspace.user?.apiKeys ?? [],
  })
}

/**
 * A tool credential map must not keep a different value for a model-provider
 * variable that resolveProviderKeys already chose.
 */
export function applyProviderKeysToToolEnv(
  env: Record<string, string>,
  providerKeys: ProviderKeyMap,
): Record<string, string> {
  const next = { ...env }
  for (const provider of SUPPORTED_PROVIDERS) {
    const value = providerKeys[provider]
    const name = PROVIDER_ENV_NAMES[provider]
    if (value && Object.prototype.hasOwnProperty.call(next, name)) next[name] = value
  }
  return next
}
