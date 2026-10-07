import http from "node:http"
import { WebSocketServer } from "ws"

const port = Number(process.env.PORT || 18789)

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/internal/sync-now") {
    const base = (process.env.CONTROL_PLANE_INTERNAL_URL || "").replace(/\/$/, "")
    const workspaceId = process.env.CLAWS_WORKSPACE_ID || ""
    const secret = String(req.headers["x-metering-secret"] || process.env.METERING_MASTER_SECRET || "")
    const payload = Buffer.from("fixture-snapshot")
    try {
      const upstream = await fetch(`${base}/api/internal/state/disk`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Metering-Secret": secret,
        },
        body: JSON.stringify({
          workspaceId,
          bytesBase64: payload.toString("base64"),
          uncompressedSize: payload.length,
        }),
      })
      if (!upstream.ok) {
        res.writeHead(502, { "Content-Type": "application/json" })
        res.end(JSON.stringify({ status: `disk-${upstream.status}` }))
        return
      }
    } catch (err) {
      res.writeHead(502, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ status: err instanceof Error ? err.message : "disk-failed" }))
      return
    }
    res.writeHead(200, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ persisted: true }))
    return
  }
  res.writeHead(404)
  res.end()
})

const wss = new WebSocketServer({ server })
wss.on("connection", (socket) => {
  socket.send(JSON.stringify({
    type: "event",
    event: "connect.challenge",
    payload: { nonce: "fixture-nonce" },
  }))
  socket.on("message", (raw) => {
    let frame
    try {
      frame = JSON.parse(String(raw))
    } catch {
      return
    }
    if (frame.type !== "req") return
    if (frame.method === "connect") {
      socket.send(JSON.stringify({ type: "res", id: frame.id, ok: true, payload: { type: "hello-ok" } }))
      return
    }
    if (frame.method === "chat.send") {
      const runId = String(frame.params?.idempotencyKey || "run")
      socket.send(JSON.stringify({
        type: "event",
        event: "chat",
        payload: {
          runId,
          state: "final",
          message: { role: "assistant", content: "fixture-reply" },
        },
      }))
      socket.send(JSON.stringify({
        type: "res",
        id: frame.id,
        ok: true,
        payload: { runId, status: "started" },
      }))
    }
  })
})

server.listen(port, "0.0.0.0", () => {
  console.log(`fixture-gateway listening on ${port}`)
})
