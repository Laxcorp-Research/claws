import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { prisma } from "@/lib/db"

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
          // DB unavailable — skip this tick
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

function formatLog(log: {
  id: string
  timestamp: Date
  agentName: string | null
  agentSlug: string | null
  action: string
  actionType: string
  apiCost: number | null
}) {
  return {
    id: log.id,
    timestamp: log.timestamp.toISOString(),
    agentName: log.agentName ?? "System",
    agentSlug: log.agentSlug,
    action: log.action,
    actionType: log.actionType,
    apiCost: log.apiCost,
  }
}
