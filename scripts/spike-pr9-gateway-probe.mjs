// SPIKE PR-9/0 — non-production, delete after PR-9/A.
//
// Live gateway-protocol probe against the SPIKE-PR9 staging workspace.
// Verifies the connect-send-disconnect mechanism PR-9/A will be built on:
//   connect → {type:"req", method:"connect", params:{auth:{token}, role:"operator", ...}}
//   → hello-ok → chat.send → close (or hold open, per test).
// Modeled on upstream callGateway (src/gateway/call.ts:758-800 @ v2026.5.22).
//
// Protocol facts baked in from upstream source reading (Phase 1):
//   - WS endpoint: wss://<containerHost> — ROOT path, no subprotocol
//   - First server frame: event "connect.challenge"
//   - connect params REQUIRE minProtocol/maxProtocol (=4) and client{id,version,platform,mode}
//   - chat.send params REQUIRE idempotencyKey; sessionKey "agent:<slug>:main"
//
// Usage (PowerShell, from repo root; requires --use-system-ca on this machine):
//   node --use-system-ca scripts/spike-pr9-gateway-probe.mjs <test> [args]
// Tests:
//   t1a  <message>          send + close immediately, then poll DB for the reply
//   t1c  <message>          send + HOLD connection, capture pushed chat/agent events
//   t3a                     token-only connect, dump hello-ok (token redacted)
//   t3b                     connect with a bad token, capture error + close code
//   t4                      dump ActivityLog rows for the spike workspace (ordered)
//   t5   <message>          send same idempotencyKey twice, capture both res frames
//   t6                      GET /sessions/<id>/history with Bearer token
//   logs                    admin HTTP RPC logs.tail (reply-evidence search)
//
// Secrets: the gateway token is read from the staging DB (driver-encrypted with
// the LOCAL master key) and REDACTED in all output.

import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { Client as PgClient } from "pg"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
// PR-9/A C7: parameterized so validation workspaces don't require editing the
// script (the original SPIKE-PR9 workspace was purged after the PR-9/0 spike).
const WORKSPACE_ID = process.env.SPIKE_WORKSPACE_ID
if (!WORKSPACE_ID) {
  console.error("Set SPIKE_WORKSPACE_ID to the target staging workspace id (e.g. $env:SPIKE_WORKSPACE_ID = \"cm...\")")
  process.exit(1)
}
const ORCH_SESSION_KEY = process.env.SPIKE_SESSION_KEY ?? "agent:dev-commander:main"
const PROTOCOL_VERSION = 4

function envOf(file) {
  const out = {}
  for (const l of fs.readFileSync(path.join(ROOT, file), "utf8").split(/\r?\n/)) {
    const m = l.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m) out[m[1]] = m[2].replace(/^"|"$/g, "")
  }
  return out
}
const staging = envOf(".env.staging")
const local = envOf(".env.local")

function decrypt(encoded, masterKeyHex, versionDefault) {
  const masterKey = Buffer.from(masterKeyHex, "hex")
  const parts = encoded.split(":")
  const version = parts.length === 4 ? parts[0] : versionDefault || "v1"
  const [iv, authTag, ciphertext] = (parts.length === 4 ? parts.slice(1) : parts).map((p) => Buffer.from(p, "base64"))
  const key = crypto.createHmac("sha256", masterKey).update(version).digest()
  const d = crypto.createDecipheriv("aes-256-gcm", key, iv)
  d.setAuthTag(authTag)
  return d.update(ciphertext) + d.final("utf8")
}

let TOKEN = null
function redact(s) {
  if (typeof s !== "string" || !TOKEN) return s
  return s.split(TOKEN).join("<GATEWAY_TOKEN_REDACTED>")
}

// ─── Device identity (PHASE 2 DIVERGENCE from Phase 1 reading) ─────────────
// A REMOTE token-auth WS client with NO device identity is allowed role
// "operator" but its self-declared scopes are CLEARED
// (shouldClearUnboundScopesForMissingDeviceIdentity, connect-policy.ts:85-100:
// authMethod "token" + no device → clear). chat.send then fails
// "missing scope: operator.write". The upstream CLI only skips device identity
// for LOOPBACK backend clients (call.ts shouldOmitDeviceIdentityForGatewayCall).
// So a remote sender MUST present an Ed25519 device identity; the first
// connect creates a pairing request, approvable out-of-band via admin HTTP RPC
// (device.pair.approve IS in the 54-method allowlist).
// Identity persists in temp so re-runs reuse the same paired device.
const IDENTITY_PATH = path.join(process.env.TEMP || "/tmp", "spike-pr9-device-identity.json")
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex")

function b64url(buf) {
  return buf.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "")
}

function loadOrCreateDeviceIdentity() {
  if (fs.existsSync(IDENTITY_PATH)) return JSON.parse(fs.readFileSync(IDENTITY_PATH, "utf8"))
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519")
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" })
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" })
  const spki = publicKey.export({ type: "spki", format: "der" })
  const raw = spki.subarray(ED25519_SPKI_PREFIX.length)
  const deviceId = crypto.createHash("sha256").update(raw).digest("hex")
  const identity = { deviceId, publicKeyPem, privateKeyPem, publicKeyRawB64u: b64url(raw) }
  fs.writeFileSync(IDENTITY_PATH, JSON.stringify(identity))
  return identity
}

// buildDeviceAuthPayloadV3 (src/gateway/device-auth.ts:36-53 @ v2026.5.22)
function buildDeviceAuthPayloadV3(p) {
  const norm = (v) => (typeof v === "string" && v.trim() ? v.trim().replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32)) : "")
  return ["v3", p.deviceId, p.clientId, p.clientMode, p.role, p.scopes.join(","), String(p.signedAtMs), p.token ?? "", p.nonce, norm(p.platform), norm(p.deviceFamily)].join("|")
}

function signDevicePayload(privateKeyPem, payload) {
  return b64url(crypto.sign(null, Buffer.from(payload, "utf8"), crypto.createPrivateKey(privateKeyPem)))
}
function logFrame(dir, obj) {
  console.log(`${new Date().toISOString()} ${dir} ${redact(JSON.stringify(obj))}`)
}

async function getWorkspace() {
  const pg = new PgClient({ connectionString: staging.DATABASE_URL })
  await pg.connect()
  const r = await pg.query('SELECT "containerHost", "gatewayToken", status FROM "Workspace" WHERE id = $1', [WORKSPACE_ID])
  await pg.end()
  const row = r.rows[0]
  if (!row) throw new Error("SPIKE-PR9 workspace not found")
  return row
}

async function openGateway({ token, onEvent } = {}) {
  const ws = await getWorkspace()
  const url = `wss://${ws.containerHost}`
  TOKEN = token ?? decrypt(ws.gatewayToken, local.ENCRYPTION_MASTER_KEY, local.ENCRYPTION_KEY_VERSION)
  const socket = new WebSocket(url)
  const pending = new Map()
  let helloOk = null
  let closeInfo = null

  const events = []
  socket.addEventListener("message", (ev) => {
    const frame = JSON.parse(typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString("utf8"))
    if (frame.type === "event") {
      events.push(frame)
      logFrame("⇦ event", frame)
      onEvent?.(frame)
    } else if (frame.type === "res") {
      logFrame("⇦ res  ", frame)
      const waiter = pending.get(frame.id)
      if (waiter) {
        pending.delete(frame.id)
        waiter.resolve(frame)
      }
    } else {
      logFrame("⇦ ?    ", frame)
    }
  })
  const closed = new Promise((resolve) => {
    socket.addEventListener("close", (ev) => {
      closeInfo = { code: ev.code, reason: ev.reason }
      console.log(`${new Date().toISOString()} ⇣ closed code=${ev.code} reason=${JSON.stringify(ev.reason)}`)
      for (const w of pending.values()) w.resolve({ type: "res", ok: false, error: { code: "WS_CLOSED" } })
      pending.clear()
      resolve(closeInfo)
    })
  })
  socket.addEventListener("error", () => {})

  function request(method, params, timeoutMs = 30000) {
    const id = crypto.randomUUID()
    const frame = { type: "req", id, method, params }
    logFrame("⇨ req  ", frame)
    socket.send(JSON.stringify(frame))
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`timeout waiting for res to ${method}`))
      }, timeoutMs)
      pending.set(id, { resolve: (f) => { clearTimeout(t); resolve(f) } })
    })
  }

  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true })
    socket.addEventListener("error", (e) => reject(new Error("WS connect failed: " + (e.message || "unknown"))), { once: true })
  })

  // Server pushes connect.challenge immediately; capture the nonce — the
  // device signature must cover it.
  await new Promise((r) => setTimeout(r, 300))
  const challenge = events.find((e) => e.event === "connect.challenge")
  const nonce = challenge?.payload?.nonce
  if (!nonce) throw new Error("no connect.challenge nonce received")

  const identity = loadOrCreateDeviceIdentity()
  const role = "operator"
  const scopes = ["operator.read", "operator.write"]
  const client = {
    id: "gateway-client",
    version: "spike-pr9-probe",
    platform: "node",
    mode: "backend",
  }
  const signedAtMs = Date.now()
  const payload = buildDeviceAuthPayloadV3({
    deviceId: identity.deviceId,
    clientId: client.id,
    clientMode: client.mode,
    role,
    scopes,
    signedAtMs,
    token: TOKEN,
    nonce,
    platform: client.platform,
    deviceFamily: undefined,
  })

  const connectRes = await request("connect", {
    minProtocol: PROTOCOL_VERSION,
    maxProtocol: PROTOCOL_VERSION,
    client,
    role,
    scopes,
    auth: { token: TOKEN },
    device: {
      id: identity.deviceId,
      publicKey: identity.publicKeyRawB64u,
      signature: signDevicePayload(identity.privateKeyPem, payload),
      signedAt: signedAtMs,
      nonce,
    },
  })
  if (connectRes.ok) helloOk = connectRes.payload
  return { socket, request, events, closed, helloOk, connectRes, close: () => socket.close(1000, "probe done"), getCloseInfo: () => closeInfo }
}

function chatSendParams(message, idempotencyKey) {
  return {
    sessionKey: ORCH_SESSION_KEY,
    message,
    idempotencyKey: idempotencyKey ?? crypto.randomUUID(),
    deliver: false,
  }
}

async function dumpActivityRows(sinceIso) {
  const pg = new PgClient({ connectionString: staging.DATABASE_URL })
  await pg.connect()
  const r = await pg.query(
    `SELECT id, "actionType", "agentSlug", action, LEFT(COALESCE(detail, ''), 200) AS detail_trunc, metadata, timestamp
     FROM "ActivityLog" WHERE "workspaceId" = $1 ${sinceIso ? 'AND timestamp >= $2' : ""}
     ORDER BY timestamp ASC`,
    sinceIso ? [WORKSPACE_ID, sinceIso] : [WORKSPACE_ID],
  )
  await pg.end()
  return r.rows
}

const tests = {
  // T1a: send, close immediately, poll the DB for evidence the run survived.
  async t1a(message = "T1a survivability probe: reply with the single word ACKNOWLEDGED-T1A.") {
    const t0 = new Date().toISOString()
    const gw = await openGateway()
    if (!gw.helloOk) throw new Error("connect failed")
    const sendT0 = Date.now()
    const res = await gw.request("chat.send", chatSendParams(message), 120000)
    console.log(`[t1a] chat.send res after ${Date.now() - sendT0}ms ok=${res.ok}`)
    gw.close()
    await gw.closed
    console.log("[t1a] WS CLOSED — now polling ActivityLog for up to 5 min for run survival evidence")
    const deadline = Date.now() + 5 * 60 * 1000
    let lastCount = 0
    while (Date.now() < deadline) {
      const rows = await dumpActivityRows(t0)
      if (rows.length !== lastCount) {
        lastCount = rows.length
        for (const row of rows) console.log(`[t1a][row] ${row.timestamp.toISOString()} ${row.actionType} agent=${row.agentSlug} action=${JSON.stringify(row.action)}`)
        if (rows.some((r) => r.actionType === "TASK_COMPLETE" || r.actionType === "TASK_FAILED")) {
          console.log("[t1a] VERDICT: run reached terminal state after disconnect — see rows above")
          return
        }
      }
      await new Promise((r) => setTimeout(r, 5000))
    }
    console.log("[t1a] VERDICT: NO terminal activity row within 5 min — POSSIBLE RUN DEATH ON DISCONNECT")
  },

  // T1c control: send and HOLD open, capture pushed events until final.
  async t1c(message = "T1c control probe: reply with the single word ACKNOWLEDGED-T1C.") {
    const gw = await openGateway()
    if (!gw.helloOk) throw new Error("connect failed")
    let finalSeen = null
    const done = new Promise((resolve) => {
      gw.socket.addEventListener("message", (ev) => {
        const frame = JSON.parse(typeof ev.data === "string" ? ev.data : Buffer.from(ev.data).toString("utf8"))
        if (frame.type === "event" && frame.event === "chat" && frame.payload?.state === "final") {
          finalSeen = frame
          resolve()
        }
      })
    })
    const sendT0 = Date.now()
    const res = await gw.request("chat.send", chatSendParams(message), 120000)
    console.log(`[t1c] chat.send res after ${Date.now() - sendT0}ms ok=${res.ok}`)
    await Promise.race([done, new Promise((r) => setTimeout(r, 4 * 60 * 1000))])
    console.log(finalSeen ? `[t1c] final chat event captured after ${Date.now() - sendT0}ms` : "[t1c] NO final event within 4 min")
    gw.close()
    await gw.closed
  },

  // T3a: token-only connect, dump hello-ok auth + whether chat.send is advertised.
  async t3a() {
    const gw = await openGateway()
    if (!gw.helloOk) throw new Error("connect failed: " + JSON.stringify(gw.connectRes.error))
    const h = gw.helloOk
    console.log("[t3a] hello-ok.protocol =", h.protocol)
    console.log("[t3a] hello-ok.server   =", JSON.stringify(h.server))
    console.log("[t3a] hello-ok.auth     =", JSON.stringify({ role: h.auth?.role, scopes: h.auth?.scopes }))
    console.log("[t3a] methods count     =", h.features?.methods?.length)
    console.log("[t3a] chat.send advertised =", h.features?.methods?.includes("chat.send"))
    console.log("[t3a] chat.history advertised =", h.features?.methods?.includes("chat.history"))
    console.log("[t3a] events advertised =", JSON.stringify(h.features?.events))
    gw.close()
    await gw.closed
  },

  // T3b: bad token → capture error res + close code.
  async t3b() {
    try {
      const gw = await openGateway({ token: "bad-token-spike-pr9-deliberately-wrong" })
      console.log("[t3b] connectRes ok =", gw.connectRes.ok)
      console.log("[t3b] connectRes.error =", JSON.stringify(gw.connectRes.error))
      const close = await Promise.race([gw.closed, new Promise((r) => setTimeout(() => r(null), 10000))])
      console.log("[t3b] close info =", JSON.stringify(close ?? gw.getCloseInfo()))
    } catch (e) {
      console.log("[t3b] threw:", e.message)
    }
  },

  // T4: ordered ActivityLog dump (full metadata) for the exchange evidence.
  async t4(sinceIso) {
    const rows = await dumpActivityRows(sinceIso)
    for (const row of rows) {
      console.log(JSON.stringify({
        ts: row.timestamp.toISOString(),
        type: row.actionType,
        agentSlug: row.agentSlug,
        action: row.action,
        detail: row.detail_trunc || null,
        metadata: row.metadata ? JSON.parse(row.metadata) : null,
      }))
    }
    console.log(`[t4] total rows: ${rows.length}`)
  },

  // T5: same idempotencyKey twice.
  async t5(message = "T5 idempotency probe: reply with the single word ACKNOWLEDGED-T5.") {
    const key = crypto.randomUUID()
    const t0 = new Date().toISOString()
    const gw = await openGateway()
    if (!gw.helloOk) throw new Error("connect failed")
    const res1 = await gw.request("chat.send", chatSendParams(message, key), 120000)
    console.log("[t5] first send ok =", res1.ok, "payload =", redact(JSON.stringify(res1.payload ?? res1.error)))
    await new Promise((r) => setTimeout(r, 4000))
    const res2 = await gw.request("chat.send", chatSendParams(message, key), 120000)
    console.log("[t5] second send ok =", res2.ok, "payload =", redact(JSON.stringify(res2.payload ?? res2.error)))
    gw.close()
    await gw.closed
    await new Promise((r) => setTimeout(r, 20000))
    const rows = (await dumpActivityRows(t0)).filter((r) => r.actionType === "MESSAGE_RECEIVED")
    console.log(`[t5] MESSAGE_RECEIVED rows since test start: ${rows.length} (expect 1 if deduped)`)
  },

  // T6: HTTP history fallback.
  async t6() {
    const ws = await getWorkspace()
    TOKEN = decrypt(ws.gatewayToken, local.ENCRYPTION_MASTER_KEY, local.ENCRYPTION_KEY_VERSION)
    // sessionId discovery: sessions.list over WS, find our session key.
    const gw = await openGateway()
    const list = await gw.request("sessions.list", {})
    const sessions = list.payload?.sessions ?? list.payload ?? []
    console.log("[t6] sessions.list count =", Array.isArray(sessions) ? sessions.length : "(shape unknown)")
    const mine = (Array.isArray(sessions) ? sessions : []).find((s) => (s.key ?? s.sessionKey) === ORCH_SESSION_KEY)
    console.log("[t6] our session entry =", redact(JSON.stringify(mine ?? null)))
    gw.close()
    await gw.closed
    const sessionId = mine?.sessionId ?? mine?.id
    if (!sessionId) { console.log("[t6] no sessionId found — cannot probe HTTP history"); return }
    const url = `https://${ws.containerHost}/sessions/${encodeURIComponent(sessionId)}/history`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } })
    const body = await res.text()
    console.log(`[t6] GET ${url.replace(ws.containerHost, "<host>")} → ${res.status}`)
    console.log("[t6] body (first 2000 chars):", redact(body.slice(0, 2000)))
  },

  // Approve the probe's device pairing via admin HTTP RPC (out-of-band,
  // same Bearer token). device.pair.list / device.pair.approve are both in
  // the 54-method admin allowlist — this is how PR-9/A can self-pair too.
  async pair() {
    const ws = await getWorkspace()
    TOKEN = decrypt(ws.gatewayToken, local.ENCRYPTION_MASTER_KEY, local.ENCRYPTION_KEY_VERSION)
    const rpc = async (method, params) => {
      const res = await fetch(`https://${ws.containerHost}/api/v1/admin/rpc`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ id: crypto.randomUUID(), method, params }),
      })
      return { status: res.status, json: await res.json() }
    }
    const list = await rpc("device.pair.list", {})
    console.log("[pair] device.pair.list HTTP", list.status, "→", redact(JSON.stringify(list.json)))
    const pending = list.json?.payload?.pending ?? []
    const identity = loadOrCreateDeviceIdentity()
    const mine = pending.find((p) => p.deviceId === identity.deviceId)
    if (!mine) { console.log("[pair] no pending request for our device — already approved?"); return }
    const approve = await rpc("device.pair.approve", { requestId: mine.requestId })
    console.log("[pair] device.pair.approve HTTP", approve.status, "→", redact(JSON.stringify(approve.json)))
  },

  // Admin HTTP RPC logs.tail — reply-evidence search in gateway logs.
  async logs() {
    const ws = await getWorkspace()
    TOKEN = decrypt(ws.gatewayToken, local.ENCRYPTION_MASTER_KEY, local.ENCRYPTION_KEY_VERSION)
    const res = await fetch(`https://${ws.containerHost}/api/v1/admin/rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ id: crypto.randomUUID(), method: "logs.tail", params: { limit: 200 } }),
    })
    const json = await res.json()
    console.log("[logs] HTTP", res.status, "ok =", json.ok)
    const lines = json.payload?.lines ?? []
    for (const l of lines.slice(-80)) console.log(redact(l))
  },
}

const [, , testName, ...args] = process.argv
if (!testName || !tests[testName]) {
  console.error(`Usage: node --use-system-ca scripts/spike-pr9-gateway-probe.mjs <${Object.keys(tests).join("|")}> [args]`)
  process.exit(1)
}
tests[testName](...args).then(() => process.exit(0)).catch((e) => {
  console.error("[probe] FAILED:", redact(e.message))
  process.exit(1)
})
