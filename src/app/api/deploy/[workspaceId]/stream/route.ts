import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { getDeployEvents, getDeployEventCount, type DeployEvent } from "@/lib/deploy-events"

export const dynamic = "force-dynamic"

const POLL_MS = 300
const HEARTBEAT_MS = 15_000
const STREAM_TIMEOUT_MS = 300_000
const TERMINAL_STATUSES = new Set(["COMPLETED", "FAILED"])

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const user = await getSessionUser()
  if (!user) return new Response("Unauthorized", { status: 401 })

  const { workspaceId } = await params
  const { error } = await verifyWorkspaceOwnership(workspaceId, user.id)
  if (error) {
    return new Response(error === "NOT_FOUND" ? "Not found" : "Forbidden", {
      status: error === "NOT_FOUND" ? 404 : 403,
    })
  }

  let closed = false
  let cursor = 0
  const startedAt = Date.now()

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

      const sendAndCheckTerminal = (events: DeployEvent[]): boolean => {
        for (const evt of events) {
          send("status", evt)
          if (TERMINAL_STATUSES.has(evt.status)) return true
        }
        return false
      }

      const existing = await getDeployEvents(workspaceId, 0)
      if (existing.length > 0) {
        cursor = existing.length
        if (sendAndCheckTerminal(existing)) {
          try { controller.close() } catch { /* already closed */ }
          return
        }
      }

      const poll = setInterval(async () => {
        if (closed) { clearInterval(poll); return }

        if (Date.now() - startedAt > STREAM_TIMEOUT_MS) {
          closed = true
          clearInterval(poll)
          try { controller.close() } catch { /* already closed */ }
          return
        }

        try {
          let events: DeployEvent[] = await getDeployEvents(workspaceId, cursor)

          if (events.length === 0 && cursor > 0) {
            const len = await getDeployEventCount(workspaceId)
            if (len > 0 && len < cursor) {
              cursor = 0
              events = await getDeployEvents(workspaceId, 0)
            }
          }

          if (events.length > 0) {
            cursor += events.length
            if (sendAndCheckTerminal(events)) {
              closed = true
              clearInterval(poll)
              try { controller.close() } catch { /* already closed */ }
              return
            }
          }
        } catch {
          // Redis unavailable - skip this tick
        }
      }, POLL_MS)

      const heartbeat = setInterval(() => {
        if (closed) { clearInterval(heartbeat); return }
        send("heartbeat", { ts: Date.now() })
      }, HEARTBEAT_MS)

      req.signal.addEventListener("abort", () => {
        closed = true
        clearInterval(poll)
        clearInterval(heartbeat)
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
