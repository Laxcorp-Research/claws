import crypto from "node:crypto"
import { signDeviceAuthV3, type ChatDeviceIdentity } from "@/lib/openclaw/device-identity"
import type { ChatSocket, ChatSocketFactory } from "@/lib/openclaw/gateway-chat-client"

const PROTOCOL_VERSION = 4
const READ_TIMEOUT_MS = 2_500
const OPERATOR_READ_SCOPES = ["operator.read"]
const CLIENT_INFO = {
  id: "gateway-client",
  version: "claws-conversations-read",
  platform: "node",
  mode: "backend",
} as const

interface GatewayFrame {
  type?: string
  id?: string
  ok?: boolean
  event?: string
  payload?: unknown
  error?: { code?: string; message?: string; details?: Record<string, unknown> }
}

export interface GatewayReadParams {
  wsUrl: string
  token: string
  deviceKey: ChatDeviceIdentity
  socketFactory?: ChatSocketFactory
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

function resolveDefaultFactory(): ChatSocketFactory {
  const NativeWebSocket = (globalThis as Record<string, unknown>).WebSocket as
    | (new (url: string) => ChatSocket)
    | undefined
  if (!NativeWebSocket) {
    throw new Error("gateway-conversations-client: no native WebSocket in this runtime")
  }
  return (url) => new NativeWebSocket(url)
}

class GatewaySession {
  private pending = new Map<string, (frame: GatewayFrame) => void>()
  private closed = false

  constructor(private socket: ChatSocket) {}

  attach(onUncorrelated?: (frame: GatewayFrame) => void) {
    this.socket.addEventListener("message", ((ev: { data: unknown }) => {
      let frame: GatewayFrame
      try {
        frame = JSON.parse(String(ev.data)) as GatewayFrame
      } catch {
        return
      }
      if (frame.type === "res" && frame.id && this.pending.has(frame.id)) {
        const resolve = this.pending.get(frame.id)!
        this.pending.delete(frame.id)
        resolve(frame)
      } else {
        onUncorrelated?.(frame)
      }
    }) as (ev: never) => void)
  }

  request(method: string, params: Record<string, unknown>, timeoutMs: number): Promise<GatewayFrame> {
    const id = crypto.randomUUID()
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve({ type: "res", id, ok: false, error: { code: "CLIENT_TIMEOUT", message: `no res to ${method} within ${timeoutMs}ms` } })
      }, timeoutMs)
      this.pending.set(id, (frame) => {
        clearTimeout(timer)
        resolve(frame)
      })
      this.socket.send(JSON.stringify({ type: "req", id, method, params }))
    })
  }

  close() {
    if (this.closed) return
    this.closed = true
    try {
      this.socket.close(1000, "conversation read complete")
    } catch {
      // best-effort close
    }
  }
}

async function approvePairing(params: GatewayReadParams, requestId: string): Promise<boolean> {
  const fetchImpl = params.fetchImpl ?? fetch
  const httpsUrl = params.wsUrl.replace(/^wss:/, "https:")
  const timeoutMs = params.timeoutMs ?? READ_TIMEOUT_MS
  try {
    const res = await fetchImpl(`${httpsUrl}/api/v1/admin/rpc`, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        Authorization: `Bearer ${params.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ id: crypto.randomUUID(), method: "device.pair.approve", params: { requestId } }),
    })
    if (!res.ok) return false
    const json = (await res.json()) as { ok?: boolean }
    return json.ok === true
  } catch {
    return false
  }
}

async function connectReadSession(params: GatewayReadParams): Promise<{ session: GatewaySession } | { requestId: string } | null> {
  const factory = params.socketFactory ?? resolveDefaultFactory()
  const timeoutMs = params.timeoutMs ?? READ_TIMEOUT_MS
  let socket: ChatSocket
  try {
    socket = factory(params.wsUrl)
  } catch {
    return null
  }

  return new Promise((resolve) => {
    const session = new GatewaySession(socket)
    let settled = false
    const settle = (result: { session: GatewaySession } | { requestId: string } | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (!result || "requestId" in result) session.close()
      resolve(result)
    }
    const timer = setTimeout(() => settle(null), timeoutMs)

    session.attach(async (frame) => {
      if (frame.type !== "event" || frame.event !== "connect.challenge") return
      const nonce = String((frame.payload as { nonce?: unknown } | undefined)?.nonce ?? "")
      if (!nonce) {
        settle(null)
        return
      }
      const signedAtMs = Date.now()
      const signature = signDeviceAuthV3({
        identity: params.deviceKey,
        clientId: CLIENT_INFO.id,
        clientMode: CLIENT_INFO.mode,
        role: "operator",
        scopes: OPERATOR_READ_SCOPES,
        signedAtMs,
        token: params.token,
        nonce,
        platform: CLIENT_INFO.platform,
      })
      const connectRes = await session.request(
        "connect",
        {
          minProtocol: PROTOCOL_VERSION,
          maxProtocol: PROTOCOL_VERSION,
          client: { ...CLIENT_INFO },
          role: "operator",
          scopes: OPERATOR_READ_SCOPES,
          auth: { token: params.token },
          device: {
            id: params.deviceKey.deviceId,
            publicKey: params.deviceKey.publicKeyRawB64u,
            signature,
            signedAt: signedAtMs,
            nonce,
          },
        },
        timeoutMs,
      )
      if (connectRes.ok) {
        settle({ session })
        return
      }
      const code = connectRes.error?.code ?? ""
      const detailCode = String(connectRes.error?.details?.code ?? "")
      if (code === "NOT_PAIRED" || detailCode === "PAIRING_REQUIRED") {
        const requestId = String(connectRes.error?.details?.requestId ?? "")
        settle(requestId ? { requestId } : null)
        return
      }
      settle(null)
    })
  })
}

async function withReadSession<T>(params: GatewayReadParams, run: (session: GatewaySession) => Promise<T | null>): Promise<T | null> {
  let connection = await connectReadSession(params)
  if (connection && "requestId" in connection) {
    const approved = await approvePairing(params, connection.requestId)
    if (!approved) return null
    connection = await connectReadSession(params)
  }
  if (!connection || !("session" in connection)) return null
  try {
    return await run(connection.session)
  } finally {
    connection.session.close()
  }
}

export async function listGatewaySessions(params: GatewayReadParams): Promise<unknown | null> {
  return withReadSession(params, async (session) => {
    const res = await session.request("sessions.list", {}, params.timeoutMs ?? READ_TIMEOUT_MS)
    return res.ok ? res.payload ?? null : null
  })
}

export async function readGatewaySessionHistory(
  params: Omit<GatewayReadParams, "deviceKey" | "socketFactory"> & { sessionKey: string },
): Promise<unknown | null> {
  const fetchImpl = params.fetchImpl ?? fetch
  const timeoutMs = params.timeoutMs ?? READ_TIMEOUT_MS
  const httpsUrl = params.wsUrl.replace(/^wss:/, "https:")
  try {
    const res = await fetchImpl(`${httpsUrl}/sessions/${encodeURIComponent(params.sessionKey)}/history`, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Authorization: `Bearer ${params.token}` },
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}
