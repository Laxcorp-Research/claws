import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, ERRORS } from "@/lib/api/response"
import { encrypt } from "@/lib/encryption"
import { validateExternalUrl } from "@/lib/security/url-validator"

export async function POST(req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { workspaceId } = await params

  const { error } = await verifyWorkspaceOwnership(workspaceId, user.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("Workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()

  const body = await req.json()
  const { name, baseUrl, authType, credential, description } = body

  if (!name || !baseUrl || !authType || !credential) return ERRORS.VALIDATION("name, baseUrl, authType, and credential are required")

  const urlCheck = validateExternalUrl(baseUrl)
  if (!urlCheck.valid) return ERRORS.VALIDATION(urlCheck.error || "Invalid URL")

  const validAuthTypes = ["API_KEY_HEADER", "BEARER_TOKEN", "BASIC_AUTH", "QUERY_PARAM"]
  if (!validAuthTypes.includes(authType)) return ERRORS.VALIDATION(`Invalid authType. Must be one of: ${validAuthTypes.join(", ")}`)

  const encryptedCredentials = encrypt(JSON.stringify({ credential }))
  const generatedSkillMd = `# SKILL: ${name}\n\n## Base URL\n${baseUrl}\n\n## Authentication\nType: ${authType}\n\n## Description\n${description || "Custom API connection."}`

  const custom = await prisma.customToolConnection.create({
    data: { workspaceId, name, baseUrl, authType, encryptedCredentials, description: description || null, generatedSkillMd },
    select: { id: true, name: true, baseUrl: true, authType: true, description: true, createdAt: true },
  })
  return apiSuccess(custom, 201)
}
