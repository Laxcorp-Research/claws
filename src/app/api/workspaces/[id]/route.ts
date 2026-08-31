import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, apiError, ERRORS } from "@/lib/api/response"
import { parseRecommendedAlwaysOn } from "@/lib/templates/recommended-always-on"
import { destroyContainer } from "@/lib/openclaw/deployer"
import { maybeResolveSpendLimitAfterLimitChange } from "@/lib/healing/spend-limit"

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
      clawTemplate: {
        select: { name: true, slug: true, category: true, workspaceSnapshot: true },
      },
      // Builder heartbeat picker needs deployed cron windows when frequency is unset.
      containerState: { select: { heartbeatCronExpressions: true } },
    },
  })

  if (!workspace) return ERRORS.NOT_FOUND("Workspace")

  let provisioningQueue: { position: number; etaAt: string; reason: string } | null = null
  if (workspace.status === "PROVISIONING_QUEUED") {
    const queueRow = await prisma.provisioningQueue.findUnique({
      where: { workspaceId: id },
      select: { enqueuedAt: true, etaAt: true, reason: true },
    })
    if (queueRow) {
      const position = await prisma.provisioningQueue.count({
        where: { enqueuedAt: { lte: queueRow.enqueuedAt } },
      })
      provisioningQueue = {
        position,
        etaAt: queueRow.etaAt.toISOString(),
        reason: queueRow.reason,
      }
    }
  }

  // Strip heavy snapshot; expose only the Always-on recommendation bit for UI.
  const { clawTemplate, ...rest } = workspace
  const recommendedAlwaysOn = parseRecommendedAlwaysOn(clawTemplate?.workspaceSnapshot)
  return apiSuccess({
    ...rest,
    provisioningQueue,
    clawTemplate: clawTemplate
      ? {
          name: clawTemplate.name,
          slug: clawTemplate.slug,
          category: clawTemplate.category,
          recommendedAlwaysOn,
        }
      : null,
  })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { id } = await params

  const { error } = await verifyWorkspaceOwnership(id, user.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("Workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()

  const body = await req.json()
  const allowed = [
    "name",
    "status",
    "apiSpendLimit",
    "costAlertThreshold",
    "description",
    "criticalAlertsOptOut",
    "alwaysOn",
    "maxRevisionRounds",
    "deliveryMode",
  ]
  const updates: Record<string, unknown> = {}
  for (const key of allowed) {
    if (body[key] !== undefined) updates[key] = body[key]
  }

  if (updates.maxRevisionRounds !== undefined) {
    const rounds = Number(updates.maxRevisionRounds)
    if (!Number.isInteger(rounds) || rounds < 0 || rounds > 20) {
      return ERRORS.VALIDATION("maxRevisionRounds must be an integer from 0 to 20")
    }
    updates.maxRevisionRounds = rounds
  }
  if (updates.deliveryMode !== undefined) {
    if (updates.deliveryMode !== "APPROVAL_REQUIRED" && updates.deliveryMode !== "AUTO_PROCEED") {
      return ERRORS.VALIDATION("deliveryMode must be APPROVAL_REQUIRED or AUTO_PROCEED")
    }
  }

  if (updates.name) {
    const duplicate = await prisma.workspace.findFirst({
      where: { userId: user.id, name: updates.name as string, id: { not: id } },
    })
    if (duplicate) return apiError("NAME_EXISTS", "A workspace with this name already exists", 409)
    updates.slug = (updates.name as string).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "")
  }

  const workspace = await prisma.workspace.update({ where: { id }, data: updates })
  if (updates.apiSpendLimit !== undefined) {
    await maybeResolveSpendLimitAfterLimitChange(id)
  }
  return apiSuccess(workspace)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { id } = await params

  const { error } = await verifyWorkspaceOwnership(id, user.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("Workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()

  // Workspace deletion: serviceDelete is correct - the claw is gone, release the Railway slot (HWD leftover empty service included).
  await destroyContainer(id)
  await prisma.workspace.delete({ where: { id } })
  return apiSuccess({ deleted: true })
}
