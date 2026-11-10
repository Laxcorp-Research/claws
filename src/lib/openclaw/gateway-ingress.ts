import http from "node:http"
import https from "node:https"
import crypto from "node:crypto"

/**
 * Hosted Railway's edge (100.64.0.0/10) forwards client headers, and 9.4
 * rejects gateway routes until that hop is listed. 10/8 and 172.16/12 cover
 * the other hosted private ranges.
 *
 * Self-host must not reuse that list. The app container dials the runtime
 * on the compose bridge, and those addresses fall inside 172.16.0.0/12
 * (and 10.0.0.0/8 on custom networks). 9.4 then treats the app as a trusted
 * proxy that failed to attribute a client and answers the websocket upgrade
 * with 403 proxy_attribution_required. The token is never read.
 */
export const HOSTED_TRUSTED_PROXIES = [
  "100.64.0.0/10",
  "10.0.0.0/8",
  "172.16.0.0/12",
] as const

const FORWARDED_HEADERS = new Set([
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-port",
  "x-forwarded-proto",
  "x-real-ip",
])

/** Null means omit gateway.trustedProxies. The dialer is the client. */
export function trustedProxiesForGateway(directClient: boolean): readonly string[] | null {
  if (directClient) return null
  return HOSTED_TRUSTED_PROXIES
}

/** Headers the chat upgrade actually sends. Forwarded hop headers are dropped. */
export function gatewayUpgradeHeaders(
  wsUrl: string,
  extra?: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = {
    Origin: `https://${new URL(wsUrl).host}`,
    Connection: "Upgrade",
    Upgrade: "websocket",
    "Sec-WebSocket-Version": "13",
    "Sec-WebSocket-Key": crypto.randomBytes(16).toString("base64"),
  }
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (FORWARDED_HEADERS.has(key.toLowerCase())) continue
      headers[key] = value
    }
  }
  return headers
}

export interface UpgradeProbeResult {
  ok: boolean
  status: number
  body: string
}

/** One websocket upgrade. 101 is healthy. A 403 body is the gateway's rejection. */
export function probeGatewayUpgrade(wsUrl: string, timeoutMs = 2000): Promise<UpgradeProbeResult> {
  const url = new URL(wsUrl)
  const secure = url.protocol === "wss:"
  const lib = secure ? https : http
  const headers = gatewayUpgradeHeaders(wsUrl)
  return new Promise((resolve) => {
    const req = lib.request({
      host: url.hostname,
      port: url.port || (secure ? 443 : 80),
      path: `${url.pathname || "/"}${url.search}`,
      headers,
      timeout: timeoutMs,
    })
    const finish = (result: UpgradeProbeResult) => {
      resolve(result)
      req.destroy()
    }
    req.on("upgrade", (res) => {
      finish({ ok: res.statusCode === 101, status: res.statusCode ?? 0, body: "" })
    })
    req.on("response", (res) => {
      const chunks: Buffer[] = []
      res.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
      res.on("end", () => {
        finish({
          ok: false,
          status: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf8").slice(0, 500),
        })
      })
    })
    req.on("timeout", () => finish({ ok: false, status: 0, body: "upgrade timed out" }))
    req.on("error", (err) => finish({ ok: false, status: 0, body: err.message }))
    req.end()
  })
}
