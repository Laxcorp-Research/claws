// PR-9/A-vercel: gateway-chat-client tests against an in-memory mock
// gateway that replays the CAPTURED frames from
// docs/OPENCLAW_GATEWAY_PROTOCOL.md appendices A.1-A.6 (challenge,
// hello-ok, NOT_PAIRED + requestId, close 1008/1013, chat.send ack,
// destroyed-container non-101 simulation).
//
// CI runs Node 20 (no native client WebSocket) - every test INJECTS the
// mock socket factory; nothing here may resolve the real implementation.
//
// Mutation-verified (PR-9/A-vercel V8):
//   M3 retry-with-fresh-key  → "V6" test fails (asserted at the route level
//                              too; here the client never invents keys)
//   M4 pairing-every-send    → V5 zero-pairing-calls assertion fails

import { describe, it, expect, vi } from "vitest"
import {
  CHAT_SEND_CLIENT_INFO,
  sendChatMessage,
  type ChatSocket,
  type ChatSocketFactory,
} from "@/lib/openclaw/gateway-chat-client"
import { generateDeviceIdentity } from "@/lib/openclaw/device-identity"

// ─── Mock gateway ──────────────────────────────────────────────────────────

type Listener = (ev: unknown) => void

interface MockGatewayOptions {
  /** Device ids the gateway considers paired. Mutated by approve. */
  paired: Set<string>
  /** Next pairing requestId handed out in NOT_PAIRED details. */
  requestId?: string
  /** Simulate transport-level failure modes. */
  mode?: "normal" | "non-101" | "close-1013" | "close-1008-token" | "silent-hang"
  /** Ack payload for chat.send. */
  ackStatus?: string
  /** Collect chat.send frames for assertions. */
  sends?: Array<Record<string, unknown>>
  /** When set, emit chat state=final after chat.send ack (awaitReplyMs path). */
  replyText?: string
}

class MockSocket implements ChatSocket {
  private listeners: Record<string, Listener[]> = { open: [], message: [], close: [], error: [] }
  public closedWith: number | undefined

  constructor(private opts: MockGatewayOptions) {
    queueMicrotask(() => {
      if (opts.mode === "non-101") {
        // Captured destroyed-container signature: error WITHOUT close.
        this.emit("error", {})
        return
      }
      if (opts.mode === "close-1013") {
        this.emit("close", { code: 1013, reason: "gateway starting" })
        return
      }
      if (opts.mode === "silent-hang") return
      // Normal: server pushes the challenge immediately (captured A.1).
      this.emit("message", {
        data: JSON.stringify({
          type: "event",
          event: "connect.challenge",
          payload: { nonce: "f03fca68-test-nonce", ts: Date.now() },
        }),
      })
    })
  }

  addEventListener(type: "open" | "message" | "close" | "error", fn: (ev: never) => void) {
    this.listeners[type].push(fn as Listener)
  }

  private emit(type: string, ev: unknown) {
    for (const fn of this.listeners[type] ?? []) fn(ev)
  }

  send(data: string) {
    const frame = JSON.parse(data) as { type: string; id: string; method: string; params: Record<string, unknown> }
    if (frame.method === "connect") {
      const device = frame.params.device as { id: string } | undefined
      if (this.opts.mode === "close-1008-token") {
        this.emit("message", {
          data: JSON.stringify({
            type: "res", id: frame.id, ok: false,
            error: { code: "INVALID_REQUEST", message: "unauthorized: gateway token mismatch (provide gateway auth token)", details: { code: "AUTH_TOKEN_MISMATCH", authReason: "token_mismatch" } },
          }),
        })
        // close is a SEPARATE IO event in reality - defer to a macrotask so
        // the res frame is fully processed first (microtasks drain between).
        setTimeout(() => this.emit("close", { code: 1008, reason: "unauthorized" }), 0)
        return
      }
      if (!device || !this.opts.paired.has(device.id)) {
        // Captured NOT_PAIRED envelope (A.2 / live capture).
        this.emit("message", {
          data: JSON.stringify({
            type: "res", id: frame.id, ok: false,
            error: { code: "NOT_PAIRED", message: "pairing required: device is not approved yet", details: { code: "PAIRING_REQUIRED", reason: "not-paired", requestId: this.opts.requestId ?? "req-test-1" } },
          }),
        })
        setTimeout(() => this.emit("close", { code: 1008, reason: "pairing required" }), 0)
        return
      }
      this.emit("message", {
        data: JSON.stringify({
          type: "res", id: frame.id, ok: true,
          payload: { type: "hello-ok", protocol: 4, auth: { role: "operator", scopes: ["operator.read", "operator.write"] } },
        }),
      })
      return
    }
    if (frame.method === "chat.send") {
      this.opts.sends?.push(frame.params)
      const runId = String(frame.params.idempotencyKey)
      this.emit("message", {
        data: JSON.stringify({
          type: "res", id: frame.id, ok: true,
          payload: { runId, status: this.opts.ackStatus ?? "started" },
        }),
      })
      if (typeof this.opts.replyText === "string") {
        queueMicrotask(() => {
          this.emit("message", {
            data: JSON.stringify({
              type: "event",
              event: "chat",
              payload: {
                runId,
                sessionKey: frame.params.sessionKey,
                state: "final",
                message: {
                  role: "assistant",
                  content: [{ type: "text", text: this.opts.replyText }],
                },
              },
            }),
          })
        })
      }
    }
  }

  close(code?: number) {
    this.closedWith = code
  }
}

function mockGateway(opts: Partial<MockGatewayOptions> = {}) {
  const state: MockGatewayOptions = {
    paired: opts.paired ?? new Set<string>(),
    requestId: opts.requestId ?? "req-test-1",
    mode: opts.mode ?? "normal",
    ackStatus: opts.ackStatus,
    sends: opts.sends ?? [],
    replyText: opts.replyText,
  }
  const sockets: MockSocket[] = []
  const factory: ChatSocketFactory = () => {
    const s = new MockSocket(state)
    sockets.push(s)
    return s
  }
  // Pairing approval endpoint (admin HTTP RPC) - approves the LAST device
  // that attempted to connect... in reality approve is by requestId; the
  // mock pairs the identity under test.
  const approveCalls: string[] = []
  const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { method: string; params: { requestId: string } }
    approveCalls.push(body.params.requestId)
    state.paired.add(pendingDeviceId!)
    return new Response(JSON.stringify({ id: "x", ok: true, payload: { requestId: body.params.requestId } }), { status: 200 })
  }) as unknown as typeof fetch
  let pendingDeviceId: string | null = null
  return {
    state,
    sockets,
    factory,
    fetchImpl,
    approveCalls,
    setPendingDevice(id: string) {
      pendingDeviceId = id
    },
    simulateRedeploy() {
      state.paired.clear()
    },
  }
}

const identity = generateDeviceIdentity()

function baseParams(gw: ReturnType<typeof mockGateway>) {
  gw.setPendingDevice(identity.deviceId)
  return {
    wsUrl: "wss://claw-test.up.railway.app",
    token: "test-gateway-token",
    deviceKey: identity,
    sessionKey: "agent:dev-commander:main",
    message: "hello",
    idempotencyKey: "idem-1",
    socketFactory: gw.factory,
    fetchImpl: gw.fetchImpl,
  }
}

describe("gateway-chat-client", () => {
  it("happy path (already paired): connect → chat.send ack → close, zero pairing calls", async () => {
    const gw = mockGateway({ paired: new Set([identity.deviceId]) })
    const result = await sendChatMessage(baseParams(gw))
    expect(result).toEqual({ ok: true, runId: "idem-1", status: "started", paired: false })
    expect(gw.approveCalls).toHaveLength(0)
    expect(gw.state.sends![0]).toMatchObject({
      sessionKey: "agent:dev-commander:main",
      message: "hello",
      idempotencyKey: "idem-1",
      deliver: false,
    })
    // Connect-send-DISCONNECT: the socket that carried the send is closed.
    expect(gw.sockets[gw.sockets.length - 1].closedWith).toBe(1000)
    expect(CHAT_SEND_CLIENT_INFO).toMatchObject({ id: "webchat-ui", mode: "webchat" })
    expect(CHAT_SEND_CLIENT_INFO.id).not.toBe("gateway-client")
    expect(CHAT_SEND_CLIENT_INFO.mode).not.toBe("backend")
  })

  it("lazy pairing path: NOT_PAIRED → approve(requestId from details) → reconnect once → ack", async () => {
    const gw = mockGateway({ requestId: "req-abc" })
    const result = await sendChatMessage(baseParams(gw))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.paired).toBe(true)
    expect(gw.approveCalls).toEqual(["req-abc"]) // requestId straight from details - no pair.list scan
    expect(gw.sockets).toHaveLength(2) // exactly one reconnect
  })

  it("V5: second send performs ZERO pairing calls; after simulated redeploy the third send pairs again", async () => {
    const gw = mockGateway()
    const first = await sendChatMessage({ ...baseParams(gw), idempotencyKey: "idem-1" })
    expect(first.ok).toBe(true)
    expect(gw.approveCalls).toHaveLength(1)

    const second = await sendChatMessage({ ...baseParams(gw), idempotencyKey: "idem-2" })
    expect(second.ok).toBe(true)
    expect(gw.approveCalls).toHaveLength(1) // ZERO new pairing calls

    gw.simulateRedeploy() // fresh gateway = unpaired (doc §8 risk 5)
    const third = await sendChatMessage({ ...baseParams(gw), idempotencyKey: "idem-3" })
    expect(third.ok).toBe(true)
    expect(gw.approveCalls).toHaveLength(2) // paired again, exactly once
  })

  it("non-101 / destroyed-container signature → unreachable (error without close handled)", async () => {
    const gw = mockGateway({ mode: "non-101" })
    const result = await sendChatMessage(baseParams(gw))
    expect(result).toMatchObject({ ok: false, reason: "unreachable" })
  })

  it("close 1013 (gateway starting) → transitioning", async () => {
    const gw = mockGateway({ mode: "close-1013" })
    const result = await sendChatMessage(baseParams(gw))
    expect(result).toMatchObject({ ok: false, reason: "transitioning" })
  })

  it("close 1008 AUTH_TOKEN_MISMATCH → unreachable (token-drift case)", async () => {
    const gw = mockGateway({ mode: "close-1008-token", paired: new Set([identity.deviceId]) })
    const result = await sendChatMessage(baseParams(gw))
    expect(result).toMatchObject({ ok: false, reason: "unreachable" })
    expect((result as { detail: string }).detail).toContain("token mismatch")
  })

  it("silent hang → unreachable after the per-attempt timeout", async () => {
    vi.useFakeTimers()
    try {
      const gw = mockGateway({ mode: "silent-hang" })
      const pending = sendChatMessage(baseParams(gw))
      await vi.advanceTimersByTimeAsync(5_100)
      const result = await pending
      expect(result).toMatchObject({ ok: false, reason: "unreachable" })
      expect((result as { detail: string }).detail).toContain("within 5000ms")
    } finally {
      vi.useRealTimers()
    }
  })

  it("pairing approval failure → honest unreachable, no reconnect loop", async () => {
    const gw = mockGateway()
    const failingFetch = vi.fn(async () => new Response(JSON.stringify({ ok: false }), { status: 401 })) as unknown as typeof fetch
    const result = await sendChatMessage({ ...baseParams(gw), fetchImpl: failingFetch })
    expect(result).toMatchObject({ ok: false, reason: "unreachable" })
    expect(gw.sockets).toHaveLength(1) // no reconnect after failed approval
  })

  it("dedupe ack shape (spike T5): second send with the SAME key resolves ok with status 'ok'", async () => {
    const gw = mockGateway({ paired: new Set([identity.deviceId]), ackStatus: "ok" })
    const result = await sendChatMessage(baseParams(gw))
    expect(result).toMatchObject({ ok: true, status: "ok" })
  })

  it("awaitReplyMs collects chat state=final assistant text (wake platform delivery)", async () => {
    const gw = mockGateway({
      paired: new Set([identity.deviceId]),
      replyText: "hello from agent on telegram",
    })
    const result = await sendChatMessage({
      ...baseParams(gw),
      sessionKey: "telegram:1227037949",
      deliver: false,
      awaitReplyMs: 5_000,
    })
    expect(result).toEqual({
      ok: true,
      runId: "idem-1",
      status: "started",
      paired: false,
      replyText: "hello from agent on telegram",
    })
    expect(gw.state.sends![0]).toMatchObject({
      sessionKey: "telegram:1227037949",
      deliver: false,
    })
  })

  it("never resolves the native WebSocket when a factory is injected (CI is Node 20)", async () => {
    // Constructing with an injected factory must not touch globalThis.WebSocket.
    const original = (globalThis as Record<string, unknown>).WebSocket
    ;(globalThis as Record<string, unknown>).WebSocket = undefined
    try {
      const gw = mockGateway({ paired: new Set([identity.deviceId]) })
      const result = await sendChatMessage(baseParams(gw))
      expect(result.ok).toBe(true)
    } finally {
      ;(globalThis as Record<string, unknown>).WebSocket = original
    }
  })
})
