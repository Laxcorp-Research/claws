import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { prisma } from "@/lib/db"
import { formatActivityLog } from "@/lib/activity-log-format"

export const dynamic = "force-dynamic"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const user = await getSessionUser()
  if (!user) {
    return new Response("Unauthorized", { status: 401 })
  }

  const { workspaceId } = await params
  const { error } = await verifyWorkspaceOwnership(workspaceId, user.id)
  if (error) {
    return new Response(error === "NOT_FOUND" ? "Not found" : "Forbidden", {
      status: error === "NOT_FOUND" ? 404 : 403,
    })
  }

  let lastTimestamp = new Date(0)
  let closed = false

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      const send = (event: string, data: unknown) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          closed = true
        }
      }

      const initialLogs = await prisma.activityLog.findMany({
        where: { workspaceId },
        orderBy: { timestamp: "desc" },
        take: 50,
      })

      if (initialLogs.length > 0) {
        lastTimestamp = initialLogs[0].timestamp
        send("init", initialLogs.map(formatLog).reverse())
      } else {
        send("init", [])
      }

      const pollInterval = setInterval(async () => {
        if (closed) {
          clearInterval(pollInterval)
          return
        }
        try {
          const newLogs = await prisma.activityLog.findMany({
            where: { workspaceId, timestamp: { gt: lastTimestamp } },
            orderBy: { timestamp: "asc" },
            take: 20,
          })
          if (newLogs.length > 0) {
            lastTimestamp = newLogs[newLogs.length - 1].timestamp
            for (const log of newLogs) {
              send("log", formatLog(log))
            }
          }
        } catch {
          // DB unavailable - skip this tick
        }
      }, 2000)

      const heartbeatInterval = setInterval(() => {
        if (closed) {
          clearInterval(heartbeatInterval)
          return
        }
        send("heartbeat", { ts: Date.now() })
      }, 15000)

      _req.signal.addEventListener("abort", () => {
        closed = true
        clearInterval(pollInterval)
        clearInterval(heartbeatInterval)
        try { controller.close() } catch { /* already closed */ }
      })
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  })
}

// PR-4d: `detail` was missing from this serializer. The regular
// /api/activity/[workspaceId] GET endpoint (PR-4) added it, but the SSE
// stream - which is what actually feeds the dashboard's live activity feed
// - was not updated, so the activity-log-entry component never saw a
// populated `detail` prop and the click-to-expand affordance never lit
// up in production. The new test file in __tests__/route.test.ts asserts
// every scalar field on the ActivityLog model is either in this output
// or in the explicit SSE_EXCLUDED_FIELDS list, so this class of bug
// cannot recur on a future column addition.
//
// Exported so the structural test can assert the field set without
// spinning up the full SSE stream consumer.
export const formatLog = formatActivityLog
