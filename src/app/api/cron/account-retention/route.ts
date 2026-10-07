import { NextRequest } from "next/server"
import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { destroyContainer } from "@/lib/openclaw/deployer"
import {
  accountDeletionDue,
  ACCOUNT_DELETION_GRACE_MS,
  workspaceHardDeleteDue,
  WORKSPACE_HARD_DELETE_MS,
} from "@/lib/trial/lifecycle-followups"

export const maxDuration = 55

/**
 * Daily retention enforcement.
 * - Account deletion requested 14 days ago: tear down containers, then delete the user.
 * - Workspace canceledAt older than 90 days: tear down, then delete the workspace.
 * Inside the 14-day account grace and inside the 90-day workspace window this is a no-op.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization")
  if (auth !== `Bearer ${process.env.CRON_SECRET}` || !process.env.CRON_SECRET) {
    return new Response("Unauthorized", { status: 401 })
  }

  const now = new Date()
  const accountCutoff = new Date(now.getTime() - ACCOUNT_DELETION_GRACE_MS)
  const workspaceCutoff = new Date(now.getTime() - WORKSPACE_HARD_DELETE_MS)

  const users = await prisma.user.findMany({
    where: { deletionRequestedAt: { lte: accountCutoff } },
    select: {
      id: true,
      deletionRequestedAt: true,
      workspaces: { where: { containerId: { not: null } }, select: { id: true } },
    },
  })

  let accountsPurged = 0
  let workspacesPurged = 0
  let errors = 0

  for (const user of users) {
    if (!accountDeletionDue(user.deletionRequestedAt, now)) continue
    for (const ws of user.workspaces) {
      try {
        await destroyContainer(ws.id)
      } catch (err) {
        log.error("account-retention: container teardown failed (continuing)", {
          userId: user.id,
          workspaceId: ws.id,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
    try {
      await prisma.user.delete({ where: { id: user.id } })
      accountsPurged++
    } catch (err) {
      errors++
      log.error("account-retention: user delete failed", {
        userId: user.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const workspaces = await prisma.workspace.findMany({
    where: { canceledAt: { lte: workspaceCutoff } },
    select: { id: true, canceledAt: true, containerId: true },
  })
  for (const ws of workspaces) {
    if (!workspaceHardDeleteDue(ws.canceledAt, now)) continue
    if (ws.containerId) {
      try {
        await destroyContainer(ws.id)
      } catch (err) {
        log.error("account-retention: 90-day teardown failed (continuing)", {
          workspaceId: ws.id,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }
    try {
      await prisma.workspace.delete({ where: { id: ws.id } })
      workspacesPurged++
    } catch (err) {
      errors++
      log.error("account-retention: workspace delete failed", {
        workspaceId: ws.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return Response.json({
    success: true,
    data: { accountsPurged, workspacesPurged, errors },
  })
}
