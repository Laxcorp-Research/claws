import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, ERRORS } from "@/lib/api/response"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { id } = await params

  const { error } = await verifyWorkspaceOwnership(id, user.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("Workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()

  const workspace = await prisma.workspace.findUnique({
    where: { id },
    include: {
      agents: { include: { skills: { include: { skill: true } } }, orderBy: { createdAt: "asc" } },
      connections: true,
      clawTemplate: { select: { name: true, slug: true, category: true } },
    },
  })

  return apiSuccess(workspace)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { id } = await params

  const { error } = await verifyWorkspaceOwnership(id, user.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("Workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()

  const body = await req.json()
  const allowed = ["name", "status", "apiSpendLimit", "costAlertThreshold", "description"]
  const updates: Record<string, unknown> = {}
  for (const key of allowed) {
    if (body[key] !== undefined) updates[key] = body[key]
  }
  if (updates.name) {
    updates.slug = (updates.name as string).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
  }

  const workspace = await prisma.workspace.update({ where: { id }, data: updates })
  return apiSuccess(workspace)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { id } = await params

  const { error } = await verifyWorkspaceOwnership(id, user.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("Workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()

  await prisma.workspace.delete({ where: { id } })
  return apiSuccess({ deleted: true })
}
