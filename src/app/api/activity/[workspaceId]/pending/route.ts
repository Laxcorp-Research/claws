import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiSuccess, ERRORS } from "@/lib/api/response"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()

  const { workspaceId } = await params
  const { error } = await verifyWorkspaceOwnership(workspaceId, user.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()

  const [humanRequests, humanResponses] = await Promise.all([
    prisma.activityLog.findMany({
      where: { workspaceId, actionType: "HUMAN_REQUEST" },
      orderBy: { timestamp: "desc" },
      take: 50,
    }),
    prisma.activityLog.findMany({
      where: {
        workspaceId,
        actionType: { in: ["HUMAN_APPROVE", "HUMAN_REJECT"] },
      },
      select: { metadata: true },
    }),
  ])

  const respondedIds = new Set<string>()
  for (const r of humanResponses) {
    try {
      const meta = JSON.parse(r.metadata || "{}")
      if (meta.originalRequestId) respondedIds.add(meta.originalRequestId)
    } catch {
      /* skip malformed metadata */
    }
  }

  const items = humanRequests
    .filter((req) => !respondedIds.has(req.id))
    .map((req) => {
      let description: string | undefined
      try {
        const meta = JSON.parse(req.metadata || "{}")
        description = meta.description
      } catch {
        /* skip */
      }
      return {
        id: req.id,
        agentName: req.agentName ?? "Unknown",
        title: req.action,
        description,
        createdAt: req.timestamp.toISOString(),
      }
    })

  return apiSuccess({ items })
}
