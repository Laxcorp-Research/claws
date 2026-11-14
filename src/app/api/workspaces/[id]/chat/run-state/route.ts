import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { ERRORS, apiSuccess } from "@/lib/api/response"
import { prisma } from "@/lib/db"
import { formatActivityLog, withFreshDeliverablePreviews, type ActivityLogFormatInput } from "@/lib/activity-log-format"
import {
  chatRunStateQueryWhere,
  parseRunStateRunIds,
  parseRunStateSince,
} from "@/lib/chat/run-state"

export const dynamic = "force-dynamic"

const MAX_ROWS = 100

// Fallback only: the chat panel polls this when the activity SSE drops or
// the tab becomes visible again. SSE (`scope=chat-run-state`) is primary.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { id } = await params

  const { error } = await verifyWorkspaceOwnership(id, user.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("Workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()

  const { searchParams } = new URL(req.url)
  const runIds = parseRunStateRunIds(searchParams.get("runIds"))
  const since = parseRunStateSince(searchParams.get("since"))

  const rows = await prisma.activityLog.findMany({
    where: chatRunStateQueryWhere(id, { runIds, since }),
    orderBy: [{ timestamp: "asc" }, { id: "asc" }],
    take: MAX_ROWS,
  })

  return apiSuccess({
    rows: await withFreshDeliverablePreviews(
      rows.map((row) => formatActivityLog(row as ActivityLogFormatInput)),
    ),
  })
}
