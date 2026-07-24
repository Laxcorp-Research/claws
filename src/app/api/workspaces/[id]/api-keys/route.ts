import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, ERRORS } from "@/lib/api/response"
import { encrypt, generateKeyHint } from "@/lib/encryption"
import { validateApiKey } from "@/lib/api-key-validation"
import {
  SUPPORTED_PROVIDERS,
  isSupportedProvider,
  type SupportedProvider,
} from "@/lib/supported-providers"

const ALL_PROVIDERS = SUPPORTED_PROVIDERS

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { id } = await params

  const { error } = await verifyWorkspaceOwnership(id, user.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("Workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()

  const [globalKeys, overrides] = await Promise.all([
    prisma.userApiKey.findMany({
      where: { userId: user.id },
      select: { provider: true, keyHint: true, isValid: true },
    }),
    prisma.workspaceApiKey.findMany({
      where: { workspaceId: id },
      select: { provider: true, keyHint: true, isValid: true },
    }),
  ])

  const status = ALL_PROVIDERS.map(provider => {
    const global = globalKeys.find(k => k.provider === provider)
    const override = overrides.find(k => k.provider === provider)
    return {
      provider,
      hasGlobalKey: !!global,
      globalKeyHint: global?.keyHint || null,
      globalKeyValid: global?.isValid || false,
      hasOverride: !!override,
      overrideKeyHint: override?.keyHint || null,
      overrideKeyValid: override?.isValid || false,
      hasKey: !!(override || global),
      effectiveSource: override ? "override" as const : global ? "global" as const : "none" as const,
    }
  })

  return apiSuccess(status)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { id } = await params

  const { error } = await verifyWorkspaceOwnership(id, user.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("Workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()

  const body = await req.json()
  const { provider, apiKey } = body as { provider?: string; apiKey?: string }

  if (!provider || !apiKey) return ERRORS.VALIDATION("provider and apiKey are required")
  if (!isSupportedProvider(provider)) {
    return ERRORS.VALIDATION(`Invalid provider. Must be one of: ${ALL_PROVIDERS.join(", ")}`)
  }

  const result = await validateApiKey(provider, apiKey)
  if (!result.valid) {
    return ERRORS.VALIDATION(result.error || `Invalid ${provider} API key.`)
  }

  const encryptedKey = encrypt(apiKey)
  const keyHint = generateKeyHint(apiKey)
  const typedProvider: SupportedProvider = provider

  await prisma.workspaceApiKey.upsert({
    where: { workspaceId_provider: { workspaceId: id, provider: typedProvider } },
    create: {
      workspaceId: id,
      provider: typedProvider,
      encryptedKey,
      keyHint,
      isValid: true,
      lastValidatedAt: new Date(),
    },
    update: {
      encryptedKey,
      keyHint,
      isValid: true,
      lastValidatedAt: new Date(),
    },
  })

  return apiSuccess({ provider, keyHint, isValid: true, source: "override" })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { id } = await params

  const { error } = await verifyWorkspaceOwnership(id, user.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("Workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()

  const body = await req.json()
  const { provider } = body as { provider?: string }
  if (!provider) return ERRORS.VALIDATION("provider is required")

  if (!isSupportedProvider(provider)) {
    return ERRORS.VALIDATION(`Invalid provider. Must be one of: ${ALL_PROVIDERS.join(", ")}`)
  }

  await prisma.workspaceApiKey.deleteMany({
    where: { workspaceId: id, provider },
  })

  return apiSuccess({ provider, removed: true })
}
