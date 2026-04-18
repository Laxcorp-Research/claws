import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, ERRORS } from "@/lib/api/response"
import { encrypt, generateKeyHint } from "@/lib/encryption"
import { log } from "@/lib/logger"
import { validateToolKey } from "@/lib/tools/validators"
import { getToolBySlug } from "@/data/tool-catalog"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { workspaceId } = await params

  const { error } = await verifyWorkspaceOwnership(workspaceId, user.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("Workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()

  const connections = await prisma.toolConnection.findMany({
    where: { workspaceId },
    select: { id: true, toolSlug: true, displayName: true, connectionType: true, keyHint: true, status: true, lastTestedAt: true, lastError: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  })
  const customConnections = await prisma.customToolConnection.findMany({
    where: { workspaceId },
    select: { id: true, name: true, baseUrl: true, authType: true, description: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  })

  return apiSuccess({
    connections,
    customConnections,
    composioOAuthAvailable: Boolean(process.env.COMPOSIO_API_KEY?.trim()),
  })
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { workspaceId } = await params

  const { error } = await verifyWorkspaceOwnership(workspaceId, user.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("Workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()

  const body = await req.json()
  const { toolSlug, displayName, connectionType, credentials, composioConnectionId, composioEntityId } = body

  if (!toolSlug || !displayName || !connectionType) return ERRORS.VALIDATION("toolSlug, displayName, and connectionType are required")

  const data: Record<string, unknown> = { workspaceId, toolSlug, displayName, connectionType, status: "PENDING" }

  if (connectionType === "API_KEY") {
    // Body must carry a credentials record. Old {apiKey: "..."} shape is
    // rejected — callers must supply {credentials: {[ENVVAR]: value, ...}}
    // matching the tool's catalog declaration.
    if (!credentials || typeof credentials !== "object" || Array.isArray(credentials)) {
      return ERRORS.VALIDATION("API_KEY tools require a `credentials` object with one entry per catalog-declared field")
    }
    const credentialEntries = Object.entries(credentials as Record<string, unknown>)
    if (credentialEntries.some(([, v]) => typeof v !== "string")) {
      return ERRORS.VALIDATION("Every credentials value must be a string")
    }

    const tool = getToolBySlug(toolSlug)
    if (!tool) return ERRORS.VALIDATION(`Unknown tool slug: ${toolSlug}`)
    if (tool.credentialFields.length === 0) {
      return ERRORS.VALIDATION(`Tool '${toolSlug}' has no credential fields declared`)
    }

    // Enforce the catalog-declared field set: every required field must be
    // present + non-empty, no extra keys allowed (tamper protection).
    const declaredEnvVars = new Set(tool.credentialFields.map((f) => f.envVar))
    const providedEnvVars = new Set(credentialEntries.map(([k]) => k))
    const missingRequired = tool.credentialFields
      .filter((f) => f.required && !(credentials[f.envVar] as string | undefined)?.trim())
      .map((f) => f.envVar)
    if (missingRequired.length > 0) {
      return ERRORS.VALIDATION(`Missing required credential fields: ${missingRequired.join(", ")}`)
    }
    const extraKeys = [...providedEnvVars].filter((k) => !declaredEnvVars.has(k))
    if (extraKeys.length > 0) {
      return ERRORS.VALIDATION(`Unknown credential fields for '${toolSlug}': ${extraKeys.join(", ")}`)
    }

    // Build a sanitized record of strings (we've asserted string values above).
    const credRecord: Record<string, string> = {}
    for (const [k, v] of credentialEntries) credRecord[k] = v as string

    const validation = await validateToolKey(toolSlug, credRecord)
    if (!validation.valid) {
      log.toolEvent({
        event: "failed",
        toolSlug,
        connectionType,
        workspaceId,
        userId: user.id,
        error: validation.error,
      })
      return ERRORS.VALIDATION(validation.error || "Invalid credentials")
    }

    data.encryptedCredentials = encrypt(JSON.stringify(credRecord))

    // keyHint is derived from the primary field's value for consistency
    // with the single-cred era. For multi-cred tools, that's the field
    // marked `primary: true` in the catalog (e.g. BINANCE_API_KEY).
    const primaryField = tool.credentialFields.find((f) => f.primary)
    const primaryValue = primaryField ? credRecord[primaryField.envVar] : undefined
    data.keyHint = primaryValue ? generateKeyHint(primaryValue) : null

    data.lastTestedAt = new Date()
    if (validation.unverified) {
      data.status = "PENDING"
      data.lastError = validation.message ?? "Connected but not verified — will be tested on first use."
    } else if (validation.warning) {
      data.status = "PENDING"
      data.lastError = validation.warning
    } else {
      data.status = "CONNECTED"
      data.lastError = null
    }
  }
  if (connectionType === "OAUTH_COMPOSIO") {
    data.composioConnectionId = composioConnectionId || null
    data.composioEntityId = composioEntityId || null
    if (composioConnectionId) data.status = "CONNECTED"
  }

  const connection = await prisma.toolConnection.upsert({
    where: { workspaceId_toolSlug: { workspaceId, toolSlug } },
    create: data as Parameters<typeof prisma.toolConnection.create>[0]["data"],
    update: { ...data, updatedAt: new Date() } as Parameters<typeof prisma.toolConnection.update>[0]["data"],
    select: { id: true, toolSlug: true, displayName: true, connectionType: true, keyHint: true, status: true, lastError: true, createdAt: true },
  })

  log.toolEvent({
    event: "connected",
    toolSlug: body.toolSlug || "unknown",
    connectionType: body.connectionType || "unknown",
    workspaceId,
    userId: user.id,
  })

  return apiSuccess(connection, 201)
}
