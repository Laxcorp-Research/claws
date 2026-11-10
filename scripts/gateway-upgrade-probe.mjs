import http from "node:http"
import crypto from "node:crypto"

const host = process.env.PROBE_HOST
if (!host) {
  process.stderr.write("PROBE_HOST is required\n")
  process.exit(1)
}
const port = Number(process.env.PROBE_PORT || 18789)

function upgrade(extra) {
  return new Promise((resolve) => {
    const headers = {
      Origin: `https://${host}:${port}`,
      Connection: "Upgrade",
      Upgrade: "websocket",
      "Sec-WebSocket-Version": "13",
      "Sec-WebSocket-Key": crypto.randomBytes(16).toString("base64"),
      ...extra,
    }
    const req = http.request({ host, port, path: "/", headers })
    const done = (result) => {
      resolve(result)
      req.destroy()
    }
    req.on("upgrade", (res, socket) => {
      const chunks = []
      const finish = () => {
        const text = Buffer.concat(chunks).toString("utf8")
        const start = text.indexOf("{")
        done({
          event: "upgrade",
          status: res.statusCode,
          frame: start >= 0 ? text.slice(start, start + 160) : "",
        })
      }
      socket.on("data", (chunk) => {
        chunks.push(chunk)
        if (Buffer.concat(chunks).length > 200) finish()
      })
      setTimeout(finish, 1500)
    })
    req.on("response", (res) => {
      const chunks = []
      res.on("data", (chunk) => chunks.push(chunk))
      res.on("end", () => {
        done({
          event: "response",
          status: res.statusCode,
          body: Buffer.concat(chunks).toString("utf8").slice(0, 400),
        })
      })
    })
    req.on("error", (err) => done({ event: "error", message: err.message }))
    req.end()
  })
}

const plain = await upgrade({})
process.stdout.write(`PLAIN ${JSON.stringify(plain)}\n`)
const token = process.env.PROBE_TOKEN || ""
if (token) {
  const authed = await upgrade({ Authorization: `Bearer ${token}` })
  process.stdout.write("TOKEN_PRESENT true\n")
  process.stdout.write(`WITH_TOKEN ${JSON.stringify(authed)}\n`)
}
