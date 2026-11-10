// PR-9/A-vercel: connect-send-disconnect gateway chat client.
//
// Implements docs/OPENCLAW_GATEWAY_PROTOCOL.md §7 - the verified send
// mechanism for dashboard chat:
//
//   1. open  wss://<containerHost>            (root path, no subprotocol)
//   2. ⇦ event connect.challenge {nonce}
//   3. ⇨ req  connect {minProtocol:4, maxProtocol:4, client, role:"operator",
//             scopes:[operator.read, operator.write], auth:{token},
//             device:{id, publicKey, signature(v3 over nonce), signedAt, nonce}}
//   4. ⇦ res  hello-ok  (or NOT_PAIRED → admin-RPC self-approve → reconnect ONCE)
//   5. ⇨ req  chat.send {sessionKey, message, idempotencyKey, deliver:false}
//   6. ⇦ res  {runId, status:"started"|"ok"}   ← acceptance-time ack (<500ms live)
//   7. close 1000
//
// Design decisions (PR-9/A-vercel Phase A, all operator-approved):
//   - Re-sign per send; NO deviceToken persistence (A4): the deviceToken
//     dies with the container (every redeploy/wake = fresh gateway), the
//     signature is ~0ms, and the connect round trip happens regardless.
//   - Lazy pairing is the NORMAL path, not an error (V5): every fresh
//     container starts unpaired. NOT_PAIRED carries details.requestId
//     directly - no device.pair.list scan needed.
//   - WebSocket factory is INJECTABLE. The default uses `ws` so Origin can
//     be https://<gateway-host> (already in controlUi.allowedOrigins).
//     webchat-ui / mode=webchat is origin-gated; native WebSocket cannot
//     set Origin. Tests always inject a mock.
//
// TIMEOUTS AS THE HONESTY LINE (A6): every captured failure signature is
// FAST - edge-404/non-101 against a destroyed container in ~440-670ms,
// close 1008 (auth) and 1013 (gateway starting) sub-second. So a 5s
// per-attempt connect timeout (matching the health monitor's
// ADMIN_RPC_TIMEOUT_MS) cleanly separates "we got a definitive signature"
// from "the host is silently hanging" - only the latter consumes the full
// 5s, and both honestly map to `unreachable`. Anything still pending at the
// ~10s total budget is aborted rather than left to Vercel's function
// timeout, so the caller always gets a typed result.

import crypto from "node:crypto"
import WebSocket from "ws"
import { log } from "@/lib/logger"
import {
  signDeviceAuthV3,
  type ChatDeviceIdentity,
} from "@/lib/openclaw/device-identity"
import { gatewayUpgradeHeaders } from "@/lib/openclaw/gateway-ingress"

const PROTOCOL_VERSION = 4
const CONNECT_TIMEOUT_MS = 5_000
const TOTAL_BUDGET_MS = 10_000
const OPERATOR_SCOPES = ["operator.read", "operator.write"]
/** Dashboard / held-flush identity. mode=webchat so OpenClaw treats the
 *  send as owner web chat. Pair with gateway-host Origin (see factory). */
export const CHAT_SEND_CLIENT_INFO = {
  id: "webchat-ui",
  version: "claws-chat-send",
  platform: "node",
  mode: "webchat",
} as const

const CLIENT_INFO = CHAT_SEND_CLIENT_INFO

// Minimal structural WebSocket surface - satisfied by both the native
// (undici) WebSocket and test doubles. Event objects are typed loosely on
// purpose: the native implementation hands DOM-flavored events; mocks hand
// plain objects.
export interface ChatSocket {
  send(data: string): void
  close(code?: number, reason?: string): void
  addEventListener(type: "open" | "message" | "close" | "error", fn: (ev: never) => void): void
}
export type ChatSocketFactory = (url: string) => ChatSocket

/** Origin OpenClaw already allowlists (generator + container host). */
export function gatewayControlUiOrigin(wsUrl: string): string {
  return `https://${new URL(wsUrl).host}`
}

function createGatewayOriginSocket(url: string): ChatSocket {
  // The app is the client. Forwarded hop headers would make 9.4 classify
  // this upgrade as an unattributable proxy and refuse it with 403.
  const headers = gatewayUpgradeHeaders(url)
  const socket = new WebSocket(url, { headers })
  let failedDetail: string | null = null
  let onError: ((ev: never) => void) | null = null
  const fail = (detail: string) => {
    if (failedDetail !== null) return
    failedDetail = detail
    onError?.({ detail } as never)
  }
  // A listener suppresses ws's own error, so the body has to be delivered here.
  socket.on("unexpected-response", (_req, res) => {
    const chunks: Buffer[] = []
    res.on("data", (chunk) => chunks.push(Buffer.from(chunk)))
    res.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8").slice(0, 500)
      fail(body || `HTTP ${res.statusCode}`)
    })
  })
  socket.on("error", () => {
    fail("socket error (non-101 upgrade or network failure)")
  })
  return {
    send(data) {
      socket.send(data)
    },
    close(code, reason) {
      socket.close(code, reason)
    },
    addEventListener(type, fn) {
      if (type === "open") {
        socket.on("open", () => fn({} as never))
        return
      }
      if (type === "message") {
        socket.on("message", (data) => {
          const text = typeof data === "string" ? data : Buffer.from(data as Uint8Array).toString("utf8")
          fn({ data: text } as never)
        })
        return
      }
      if (type === "close") {
        socket.on("close", (code, reason) => {
          fn({ code, reason: reason?.toString() } as never)
        })
        return
      }
      onError = fn
      if (failedDetail !== null) fn({ detail: failedDetail } as never)
    },
  }
}

export type SendChatFailureReason =
  | "unreachable" // edge-404 / non-101 / timeout / auth mismatch / no ack
  | "transitioning" // close 1013 - container up, gateway still starting

export type SendChatResult =
  | { ok: true; runId: string; status: string; paired: boolean; replyText?: string | null }
  | { ok: false; reason: SendChatFailureReason; detail: string }

export interface SendChatMessageParams {
  wsUrl: string
  token: string
  deviceKey: ChatDeviceIdentity
  sessionKey: string
  message: string
  idempotencyKey: string
  /**
   * When true, ask the gateway to deliver the agent reply on the channel
   * session. Operator `chat.send` stamps webchat origin, so Telegram wake
   * must NOT rely on this - use `awaitReplyMs` + platform Bot API instead.
   */
  deliver?: boolean
  /**
   * When set, hold the WS after chat.send ack until a matching chat
   * `state:"final"` (or error/aborted) event arrives, then return replyText.
   * Used by wake-on-channel platform Telegram delivery.
   */
  awaitReplyMs?: number
  /** Injectable for tests; default is `ws` with gateway-host Origin. */
  socketFactory?: ChatSocketFactory
  /** Injectable fetch for the pairing admin-RPC call (tests). */
  fetchImpl?: typeof fetch
}

/** Extract assistant plain text from a gateway chat event payload. */
export function extractAssistantTextFromChatPayload(
  payload: Record<string, unknown> | undefined,
): string | null {
  if (!payload) return null
  const message = payload.message as
    | { role?: unknown; content?: unknown }
    | undefined
  if (!message || message.role !== "assistant") return null
  const content = message.content
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return null
  const parts: string[] = []
  for (const part of content) {
    if (typeof part === "string") {
      parts.push(part)
      continue
    }
    if (part && typeof part === "object" && "text" in part) {
      const text = (part as { text?: unknown }).text
      if (typeof text === "string") parts.push(text)
    }
  }
  const joined = parts.join("")
  return joined.length > 0 ? joined : null
}

interface GatewayFrame {
  type?: string
  id?: string
  ok?: boolean
  event?: string
  payload?: Record<string, unknown>
  error?: { code?: string; message?: string; details?: Record<string, unknown> }
}

// Lazy default: never resolved at module import (CI runs Node 20 with no
// native client WebSocket; tests always inject). Fail loud, not silent.
function resolveDefaultFactory(): ChatSocketFactory {
  return createGatewayOriginSocket
}

/** One WS connection attempt: connect frame → hello-ok | NOT_PAIRED | failure. */
interface ConnectAttemptResult {
  kind: "hello-ok" | "not-paired" | "failure"
  socket?: GatewaySession
  requestId?: string
  reason?: SendChatFailureReason
  detail?: string
}

/** Live session wrapper: request/response correlation over the socket. */
class GatewaySession {
  private pending = new Map<string, (frame: GatewayFrame) => void>()
  private eventWaiters: Array<(frame: GatewayFrame) => void> = []
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
        for (const waiter of [...this.eventWaiters]) waiter(frame)
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
      // Register the resolver BEFORE sending: a synchronous transport (or a
      // very fast gateway) can deliver the response during send(), so the
      // pending entry must exist first or the res is dropped as uncorrelated.
      this.pending.set(id, (frame) => {
        clearTimeout(timer)
        resolve(frame)
      })
      this.socket.send(JSON.stringify({ type: "req", id, method, params }))
    })
  }

  /**
   * Wait for a chat event with matching runId and terminal state.
   * Register BEFORE chat.send to avoid missing a fast final.
   */
  waitForChatFinal(runId: string, timeoutMs: number): Promise<string | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.eventWaiters = this.eventWaiters.filter((w) => w !== waiter)
        resolve(null)
      }, timeoutMs)
      const waiter = (frame: GatewayFrame) => {
        if (frame.type !== "event" || frame.event !== "chat") return
        const payload = frame.payload ?? {}
        if (String(payload.runId ?? "") !== runId) return
        const state = String(payload.state ?? "")
        if (state === "final") {
          clearTimeout(timer)
          this.eventWaiters = this.eventWaiters.filter((w) => w !== waiter)
          resolve(extractAssistantTextFromChatPayload(payload))
          return
        }
        if (state === "error" || state === "aborted") {
          clearTimeout(timer)
          this.eventWaiters = this.eventWaiters.filter((w) => w !== waiter)
          resolve(null)
        }
      }
      this.eventWaiters.push(waiter)
    })
  }

  close() {
    if (this.closed) return
    this.closed = true
    try {
      this.socket.close(1000, "send complete")
    } catch {
      // closing an already-failed socket is best-effort
    }
  }
}

async function connectAttempt(params: SendChatMessageParams, factory: ChatSocketFactory): Promise<ConnectAttemptResult> {
  let socket: ChatSocket
  try {
    socket = factory(params.wsUrl)
  } catch (err) {
    return { kind: "failure", reason: "unreachable", detail: `socket construction failed: ${err instanceof Error ? err.message : String(err)}` }
  }

  return new Promise<ConnectAttemptResult>((resolve) => {
    let settled = false
    const session = new GatewaySession(socket)
    let challengeNonce: string | null = null

    const settle = (result: ConnectAttemptResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (result.kind === "failure") session.close()
      resolve(result)
    }

    // 5s per-attempt cap: all captured definitive signatures arrive in
    // <1s; only a silent hang reaches this. See header comment.
    const timer = setTimeout(() => {
      settle({ kind: "failure", reason: "unreachable", detail: `no challenge/hello within ${CONNECT_TIMEOUT_MS}ms` })
    }, CONNECT_TIMEOUT_MS)

    session.attach(async (frame) => {
      // Pre-auth server push: the challenge. Sign + send connect.
      if (frame.type === "event" && frame.event === "connect.challenge") {
        challengeNonce = String(frame.payload?.nonce ?? "")
        if (!challengeNonce) {
          settle({ kind: "failure", reason: "unreachable", detail: "challenge frame without nonce" })
          return
        }
        const signedAtMs = Date.now()
        const signature = signDeviceAuthV3({
          identity: params.deviceKey,
          clientId: CLIENT_INFO.id,
          clientMode: CLIENT_INFO.mode,
          role: "operator",
          scopes: OPERATOR_SCOPES,
          signedAtMs,
          token: params.token,
          nonce: challengeNonce,
          platform: CLIENT_INFO.platform,
        })
        const connectRes = await session.request(
          "connect",
          {
            minProtocol: PROTOCOL_VERSION,
            maxProtocol: PROTOCOL_VERSION,
            client: { ...CLIENT_INFO },
            role: "operator",
            scopes: OPERATOR_SCOPES,
            auth: { token: params.token },
            device: {
              id: params.deviceKey.deviceId,
              publicKey: params.deviceKey.publicKeyRawB64u,
              signature,
              signedAt: signedAtMs,
              nonce: challengeNonce,
            },
          },
          CONNECT_TIMEOUT_MS,
        )
        if (connectRes.ok) {
          settle({ kind: "hello-ok", socket: session })
          return
        }
        const code = connectRes.error?.code ?? ""
        const detailCode = String(connectRes.error?.details?.code ?? "")
        if (code === "NOT_PAIRED" || detailCode === "PAIRING_REQUIRED") {
          const requestId = String(connectRes.error?.details?.requestId ?? "")
          settle(requestId
            ? { kind: "not-paired", requestId }
            : { kind: "failure", reason: "unreachable", detail: "NOT_PAIRED without requestId" })
          return
        }
        if (detailCode === "AUTH_TOKEN_MISMATCH") {
          // Token drift: the DB token no longer matches the container's.
          // Outside the reconciliation cron's 3-field contract - log loudly
          // (docs/OPENCLAW_GATEWAY_PROTOCOL.md §8 risk 1) and report
          // unreachable; the user can't act on auth internals.
          log.error("gateway-chat-client: gateway token mismatch - possible token drift", {
            wsUrl: params.wsUrl,
          })
          settle({ kind: "failure", reason: "unreachable", detail: "gateway token mismatch" })
          return
        }
        settle({ kind: "failure", reason: "unreachable", detail: `connect rejected: ${code} ${connectRes.error?.message ?? ""}` })
      }
    })

    socket.addEventListener("close", ((ev: { code?: number; reason?: string }) => {
      // 1013 = gateway still starting (captured) → honest "transitioning".
      if (ev?.code === 1013) {
        settle({ kind: "failure", reason: "transitioning", detail: "gateway starting (close 1013)" })
        return
      }
      settle({ kind: "failure", reason: "unreachable", detail: `socket closed pre-auth (code ${ev?.code ?? "?"})` })
    }) as (ev: never) => void)

    socket.addEventListener("error", ((ev: { detail?: string }) => {
      // Native WebSocket fires `error` WITHOUT a subsequent `close` for
      // non-101 upgrades (destroyed-container signature, captured ~440ms).
      const detail = ev?.detail?.trim()
        ? ev.detail
        : "socket error (non-101 upgrade or network failure)"
      settle({ kind: "failure", reason: "unreachable", detail })
    }) as (ev: never) => void)
  })
}

/** Admin HTTP RPC device.pair.approve - same Bearer + AbortController pattern as the health monitor. */
async function approvePairing(params: SendChatMessageParams, requestId: string): Promise<boolean> {
  const fetchImpl = params.fetchImpl ?? fetch
  const httpsUrl = params.wsUrl.replace(/^wss:/, "https:")
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), CONNECT_TIMEOUT_MS)
  try {
    const res = await fetchImpl(`${httpsUrl}/api/v1/admin/rpc`, {
      method: "POST",
      signal: controller.signal,
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
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Connect-send-disconnect. Resolves with a typed result - never throws for
 * gateway-side failures. Lazy pairing: one NOT_PAIRED → approve → reconnect
 * cycle; an already-paired device skips pairing entirely (zero admin-RPC
 * calls - asserted by the V5 test).
 */
export async function sendChatMessage(params: SendChatMessageParams): Promise<SendChatResult> {
  const factory = params.socketFactory ?? resolveDefaultFactory()
  const startedAt = Date.now()
  let paired = false

  let attempt = await connectAttempt(params, factory)

  if (attempt.kind === "not-paired") {
    const approved = await approvePairing(params, attempt.requestId!)
    if (!approved) {
      return { ok: false, reason: "unreachable", detail: "device pairing approval failed" }
    }
    paired = true
    if (Date.now() - startedAt > TOTAL_BUDGET_MS - CONNECT_TIMEOUT_MS) {
      return { ok: false, reason: "unreachable", detail: "budget exhausted before reconnect" }
    }
    // Exactly ONE reconnect after pairing (V5) - a second NOT_PAIRED here
    // means the gateway is misbehaving; fail honestly rather than loop.
    attempt = await connectAttempt(params, factory)
    if (attempt.kind === "not-paired") {
      return { ok: false, reason: "unreachable", detail: "still NOT_PAIRED after approval" }
    }
  }

  if (attempt.kind === "failure") {
    return { ok: false, reason: attempt.reason!, detail: attempt.detail ?? "connect failed" }
  }

  const session = attempt.socket!
  try {
    const remaining = Math.max(1_000, TOTAL_BUDGET_MS - (Date.now() - startedAt))
    const awaitReplyMs =
      typeof params.awaitReplyMs === "number" && params.awaitReplyMs > 0
        ? params.awaitReplyMs
        : 0
    // Predicted runId equals idempotencyKey (protocol §4) - arm waiter before send.
    const predictedRunId = params.idempotencyKey
    const replyWait =
      awaitReplyMs > 0 ? session.waitForChatFinal(predictedRunId, awaitReplyMs) : null

    const ack = await session.request(
      "chat.send",
      {
        sessionKey: params.sessionKey,
        message: params.message,
        idempotencyKey: params.idempotencyKey,
        deliver: params.deliver === true,
      },
      remaining,
    )
    if (ack.ok) {
      const payload = (ack.payload ?? {}) as { runId?: string; status?: string }
      const runId = String(payload.runId ?? params.idempotencyKey)
      let replyText: string | null | undefined
      if (replyWait) {
        // If gateway returned a different runId, wait on that too is rare;
        // predicted id matches live captures. Still resolve the armed waiter.
        replyText = runId === predictedRunId
          ? await replyWait
          : await session.waitForChatFinal(runId, awaitReplyMs)
      }
      return {
        ok: true,
        runId,
        status: String(payload.status ?? "started"),
        paired,
        ...(awaitReplyMs > 0 ? { replyText: replyText ?? null } : {}),
      }
    }
    return { ok: false, reason: "unreachable", detail: `chat.send rejected: ${ack.error?.code ?? "?"} ${ack.error?.message ?? ""}` }
  } finally {
    session.close()
  }
}
