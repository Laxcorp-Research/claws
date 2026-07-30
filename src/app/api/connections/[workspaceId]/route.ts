import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, ERRORS } from "@/lib/api/response"
import { CONTEXT_NOTE_MAX_CHARS, normalizeContextNote } from "@/lib/openclaw/workflow-language"
import { isLegalSolidEdge } from "@/lib/openclaw/validate-topology"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { workspaceId } = await params

  const { error } = await verifyWorkspaceOwnership(workspaceId, user.id)
  if (error) return error === "NOT_FOUND" ? ERRORS.NOT_FOUND("Workspace") : ERRORS.FORBIDDEN()

  const connections = await prisma.agentConnection.findMany({ where: { workspaceId } })
  return apiSuccess(connections)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ workspaceId: string }> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { workspaceId } = await params

  const { error } = await verifyWorkspaceOwnership(workspaceId, user.id)
  if (error) return error === "NOT_FOUND" ? ERRORS.NOT_FOUND("Workspace") : ERRORS.FORBIDDEN()

  const body = await req.json() as {
    sourceAgentId?: string
    targetAgentId?: string
    label?: string | null
    conditionExpr?: string | null
    contextNote?: string | null
  }

  if (!body.sourceAgentId || !body.targetAgentId) {
    return ERRORS.VALIDATION("sourceAgentId and targetAgentId are required")
  }

  const agents = await prisma.agent.findMany({
    where: { workspaceId, id: { in: [body.sourceAgentId, body.targetAgentId] } },
    select: { id: true, role: true },
  })
  const source = agents.find((a) => a.id === body.sourceAgentId)
  const target = agents.find((a) => a.id === body.targetAgentId)
  if (!source || !target) {
    return ERRORS.VALIDATION("Both agents must belong to this workspace")
  }

  if (
    !isLegalSolidEdge({
      sourceRole: source.role,
      targetRole: target.role,
      sourceId: source.id,
      targetId: target.id,
    })
  ) {
    return ERRORS.VALIDATION("Only Commander → Worker connections are allowed.")
  }

  let contextNote = normalizeContextNote(body.contextNote)
  if (body.contextNote != null && typeof body.contextNote === "string" && body.contextNote.trim().length > CONTEXT_NOTE_MAX_CHARS) {
    contextNote = normalizeContextNote(body.contextNote)
  }

  // WIRE-FULL X2: seeds/API write ON_COMPLETE uniformly; generator ignores condition.
  const connection = await prisma.agentConnection.create({
    data: {
      workspaceId,
      sourceAgentId: body.sourceAgentId,
      targetAgentId: body.targetAgentId,
      condition: "ON_COMPLETE",
      label: body.label || null,
      conditionExpr: body.conditionExpr || null,
      contextNote,
    },
  })
  return apiSuccess(connection, 201)
}
