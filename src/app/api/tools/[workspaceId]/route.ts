import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, ERRORS } from "@/lib/api/response"
import { encrypt, generateKeyHint } from "@/lib/encryption"
import { log } from "@/lib/logger"
import { validateToolKey } from "@/lib/tools/validators"
import { getPrimaryCredentialField } from "@/data/tool-catalog"

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
  const { toolSlug, displayName, connectionType, apiKey, composioConnectionId, composioEntityId } = body

  if (!toolSlug || !displayName || !connectionType) return ERRORS.VALIDATION("toolSlug, displayName, and connectionType are required")

  const data: Record<string, unknown> = { workspaceId, toolSlug, displayName, connectionType, status: "PENDING" }

  if (connectionType === "API_KEY" && apiKey) {
    // Commit 3 keeps the {apiKey} body shape; commit 4 switches to
    // {credentials}. For now, wrap the single field into the catalog's
    // primary envVar so validators receive the new record shape.
    const primaryField = getPrimaryCredentialField(toolSlug)
    if (!primaryField) {
      return ERRORS.VALIDATION(`No credential fields declared for tool '${toolSlug}'`)
    }
    const validation = await validateToolKey(toolSlug, { [primaryField.envVar]: apiKey })
    if (!validation.valid) {
      log.toolEvent({
        event: "failed",
        toolSlug,
        connectionType,
        workspaceId,
        userId: user.id,
        error: validation.error,
      })
      return ERRORS.VALIDATION(validation.error || "Invalid API key")
    }

    data.encryptedApiKey = encrypt(apiKey)
    data.keyHint = generateKeyHint(apiKey)
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
