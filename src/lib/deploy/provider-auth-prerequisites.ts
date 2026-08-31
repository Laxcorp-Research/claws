/**
 * Deploy-time provider auth gate. Same truth as the model picker:
 * a required model's provider must have a key or (Anthropic only) active credits.
 * Exhausted credits are not an auth path (that boots dead).
 */
import { prisma } from "@/lib/db"
import { getApiKeySource } from "@/lib/credits/api-key-source"
import {
  modelDeployWarning,
  validConfiguredProviders,
  type ProviderKeySlice,
} from "@/lib/models/provider-auth"
import { providerFromModelRef, SUPPORTED_PROVIDERS } from "@/lib/supported-providers"
import { providerLabel } from "@/lib/models/provider-labels"

export const PROVIDER_AUTH_MISSING = "PROVIDER_AUTH_MISSING"

export type ProviderAuthPrerequisite =
  | { ok: true }
  | { ok: false; code: typeof PROVIDER_AUTH_MISSING; message: string; missingProviders: string[] }

function creditModeActive(source: string, creditStatus: string | null): boolean {
  return source === "PLATFORM_CREDIT" && creditStatus === "ACTIVE"
}

export function evaluateProviderAuthForModels(args: {
  models: string[]
  creditMode: boolean
  configuredProviders: readonly string[]
}): ProviderAuthPrerequisite {
  const missing = new Set<string>()
  for (const model of args.models) {
    const warning = modelDeployWarning(model, {
      creditMode: args.creditMode,
      configuredProviders: args.configuredProviders,
    })
    if (warning) {
      const provider = providerFromModelRef(model)
      if (provider) missing.add(provider)
    }
  }
  if (missing.size === 0) return { ok: true }
  const missingProviders = [...missing]
  if (missingProviders.length === 1) {
    const provider = missingProviders[0]
    const model = args.models.find((m) => providerFromModelRef(m) === provider) ?? args.models[0]
    const warning = modelDeployWarning(model, {
      creditMode: args.creditMode,
      configuredProviders: args.configuredProviders,
    })
    return {
      ok: false,
      code: PROVIDER_AUTH_MISSING,
      message: warning ?? `Add a ${providerLabel(provider)} API key before deploy`,
      missingProviders,
    }
  }
  const names = missingProviders.map((p) => providerLabel(p))
  return {
    ok: false,
    code: PROVIDER_AUTH_MISSING,
    message: `Add API keys for ${names.join(", ")} before deploy`,
    missingProviders,
  }
}

export async function evaluateWorkspaceDeployProviderAuth(
  workspaceId: string,
): Promise<ProviderAuthPrerequisite> {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: {
      apiKeySourceOverride: true,
      userId: true,
      user: {
        select: {
          apiKeySource: true,
          creditAccount: { select: { status: true } },
        },
      },
      agents: { select: { model: true } },
    },
  })
  if (!workspace) {
    return { ok: false, code: PROVIDER_AUTH_MISSING, message: "Workspace not found", missingProviders: [] }
  }

  const source = getApiKeySource(workspace, workspace.user)
  const creditMode = creditModeActive(source, workspace.user.creditAccount?.status ?? null)

  const [globalKeys, overrides] = await Promise.all([
    prisma.userApiKey.findMany({
      where: { userId: workspace.userId },
      select: { provider: true, isValid: true },
    }),
    prisma.workspaceApiKey.findMany({
      where: { workspaceId },
      select: { provider: true, isValid: true },
    }),
  ])

  const slices: ProviderKeySlice[] = SUPPORTED_PROVIDERS.map((provider) => {
    const global = globalKeys.find((k) => k.provider === provider)
    const override = overrides.find((k) => k.provider === provider)
    return {
      provider,
      effectiveSource: override ? "override" : global ? "global" : "none",
      overrideKeyValid: override?.isValid ?? false,
      globalKeyValid: global?.isValid ?? false,
    }
  })

  const configuredProviders = validConfiguredProviders(slices)
  const models = workspace.agents.map((a) => a.model).filter((m) => m.length > 0)
  return evaluateProviderAuthForModels({ models, creditMode, configuredProviders })
}
