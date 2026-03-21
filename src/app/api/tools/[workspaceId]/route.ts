import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, ERRORS } from "@/lib/api/response"
import { encrypt, generateKeyHint } from "@/lib/encryption"

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

  return apiSuccess({ connections, customConnections })
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
    data.encryptedApiKey = encrypt(apiKey)
    data.keyHint = generateKeyHint(apiKey)
    data.status = "CONNECTED"
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
    select: { id: true, toolSlug: true, displayName: true, connectionType: true, keyHint: true, status: true, createdAt: true },
  })

  return apiSuccess(connection, 201)
}
