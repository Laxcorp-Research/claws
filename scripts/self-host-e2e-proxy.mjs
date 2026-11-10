// CI only. Chromium's follow-up requests stall on Docker's published port.
// The browser dials this process on localhost. This process dials the container.
import http from "node:http"
import net from "node:net"

const targetHost = "127.0.0.1"
const targetPort = Number(process.env.PROXY_TARGET_PORT || 3002)
const listenPort = Number(process.env.PROXY_LISTEN_PORT || 3001)

const server = http.createServer((clientReq, clientRes) => {
  const upstream = http.request(
    {
      host: targetHost,
      port: targetPort,
      method: clientReq.method,
      path: clientReq.url,
      headers: clientReq.headers,
    },
    (upstreamRes) => {
      clientRes.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers)
      upstreamRes.pipe(clientRes)
    },
  )
  upstream.on("error", () => {
    if (!clientRes.headersSent) clientRes.writeHead(502)
    clientRes.end()
  })
  clientReq.pipe(upstream)
})

server.on("upgrade", (req, socket, head) => {
  const upstream = net.connect(targetPort, targetHost, () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`]
    for (const [key, value] of Object.entries(req.headers)) {
      if (value === undefined) continue
      for (const item of Array.isArray(value) ? value : [value]) {
        lines.push(`${key}: ${item}`)
      }
    }
    upstream.write(`${lines.join("\r\n")}\r\n\r\n`)
    if (head.length > 0) upstream.write(head)
    upstream.pipe(socket)
    socket.pipe(upstream)
  })
  const drop = () => {
    socket.destroy()
    upstream.destroy()
  }
  upstream.on("error", drop)
  socket.on("error", drop)
})

server.listen(listenPort, "127.0.0.1")
