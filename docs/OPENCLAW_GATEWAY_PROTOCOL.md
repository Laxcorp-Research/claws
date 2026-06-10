# OpenClaw Gateway Protocol — Verified Contract for Dashboard Chat (PR-9/0)

This is the durable artifact of the PR-9/0 gateway-protocol spike. PR-9/A (dashboard
chat send backend) is built against this document. Every claim is **captured evidence**
(real frames, real payloads, real DB rows) or an upstream source citation at the exact
tag our production image is built from — nothing here is inference.

---

## 1. Scope & provenance

| What | Value |
|---|---|
| Runtime image verified | `ghcr.io/laxcorp-research/openclaw-runtime:2026.5.22-1` (staging DB stable `OpenClawVersion` row; `-1` = overlay-only rebuild suffix per `.github/workflows/build-openclaw-image.yml:166-184`) |
| Upstream source read | `github.com/openclaw/openclaw` tag `v2026.5.22` = commit `a374c3a5bfd5225ce319bce3865aab6216309c4f` (`buildSourceTag` of the stable row) |
| Live verification | Staging workspace **SPIKE-PR9** (`cmq81n2cp000210hq54sxz61c`), Developer Productivity OS template, orchestrator slug `dev-commander`, BYOK key source. Deployed/destroyed twice (2026-06-10); all residue rows purged after close-out; WIRE-TEST verified field-wise untouched before/after. |
| Probe | `scripts/spike-pr9-gateway-probe.mjs` (non-production; PR-9/A deletes it). Replaces the deleted `scripts/probe-gateway-api.mjs`, which was hardcoded to a destroyed container. |
| Evidence status | **Complete.** Phase 2 ran with a placeholder LLM key (transport/auth/routing/idempotency evidence only + a captured errored-turn shape). The reply-path gap was **closed 2026-06-10** with a valid key: a genuine multi-step assistant reply was captured end-to-end (§5). |
| Upstream citations | `file:line` references below are to the `v2026.5.22` clone unless prefixed `laxclaws:`. |

---

## 2. Gateway surface map

One **multiplexed port** serves everything — WS + HTTP, default **18789**
(`src/config/types.gateway.ts:448-450`; our generator pins it: `laxclaws:src/lib/openclaw/generator.ts:314-321`,
and Railway exposes it as `https://<containerHost>` / `wss://<containerHost>`).

### WebSocket

- **Path: root.** The `WebSocketServer` is `noServer` with no path or subprotocol filter
  (`src/gateway/server-runtime-state.ts:226-228`); every non-plugin HTTP upgrade is handed to
  `wss.handleUpgrade` with no pathname check (`src/gateway/server-http.ts:843-964`).
  `wss://<containerHost>` is the complete URL. No subprotocol, no required headers.
- **Method registry:** 191 core methods (`src/gateway/methods/core-descriptors.ts:18-210`) plus
  plugin methods. Live `hello-ok` advertised 173 on our image. Relevant to chat:
  `chat.send`, `chat.history`, `chat.abort` (scope `operator.write` / `operator.read`),
  `sessions.list`, `sessions.send` (wraps `chat.send`), `sessions.messages.subscribe`.
  Hidden-but-callable: `chat.inject` (`operator.admin`), `sessions.steer`.

### HTTP

| Endpoint | Auth | Notes |
|---|---|---|
| `GET /healthz` | none | `{"ok":true,"status":"live"}` (captured) |
| `GET /readyz` | none | channel readiness (`docs/CONTAINER_INFRASTRUCTURE.md:146-147`) |
| `POST /api/v1/admin/rpc` | `Authorization: Bearer <OPENCLAW_GATEWAY_TOKEN>` | Restricted **54-method allowlist** (below). Body `{id?, method, params?}` → `{id, ok, payload?, error?}` — no `type:"req"` wrapper (`extensions/admin-http-rpc/src/handler.ts:17-38,161-179`) |
| `GET /sessions/<sessionKEY>/history` | Bearer token | **Takes the session KEY** (e.g. `agent:dev-commander:main`), *not* the internal session id (captured: key → 200, internal id → 404 "Session not found"). Wired at `src/gateway/server-http.ts:231,643-648`. Returns the full transcript (§5 shape) |

**Admin HTTP RPC allowlist** (`extensions/admin-http-rpc/src/methods.ts:1-55`) — note
**no `chat.send`**, but **`device.pair.list` / `device.pair.approve` ARE here** (load-bearing for §3):

> health, status, logs.tail, usage.status, usage.cost, gateway.restart.request,
> commands.list, config.get, config.schema, config.schema.lookup, config.set,
> config.patch, config.apply, channels.status, channels.start, channels.stop,
> channels.logout, web.login.start, web.login.wait, models.list, models.authStatus,
> agents.list, agents.create, agents.update, agents.delete, exec.approvals.get,
> exec.approvals.set, exec.approvals.node.get, exec.approvals.node.set, cron.status,
> cron.list, cron.get, cron.runs, cron.add, cron.update, cron.remove, cron.run,
> device.pair.list, device.pair.approve, device.pair.reject, device.pair.remove,
> node.list, node.describe, node.pair.list, node.pair.approve, node.pair.reject,
> node.pair.remove, node.rename, tasks.list, tasks.get, tasks.cancel,
> doctor.memory.status, update.status

Unsupported methods → HTTP 400 `{"ok":false,"error":{"code":"INVALID_REQUEST","message":"admin HTTP RPC method is not supported: …"}}`
(`extensions/admin-http-rpc/src/handler.ts:140-148`).

### Protocol frame envelope (`src/gateway/protocol/schema/frames.ts`)

| Frame | Shape |
|---|---|
| Request | `{type:"req", id:"<uuid>", method, params?}` |
| Response | `{type:"res", id, ok, payload?, error?:{code,message,details?,retryable?,retryAfterMs?}}` |
| Server push | `{type:"event", event:"<name>", payload?, seq?}` |

Chat-relevant pushed events: `chat` (deltas/final), `agent` (lifecycle + assistant stream),
`session.message`, `sessions.changed`, plus `connect.challenge`, `health`, `tick`.

---

## 3. Auth & device identity

### Token plumbing (Claws side, recap from Phase A audit)

`OPENCLAW_GATEWAY_TOKEN` is generated per deploy (`laxclaws:generator.ts:190`), stored
AES-256-GCM-encrypted on `Workspace.gatewayToken` (`laxclaws:deployer.ts:310`), and emitted
to the container by **three** paths: top-level Railway var (`laxclaws:deployer.ts:500`),
inside `CLAWS_ENV_B64` (`laxclaws:generator.ts:639`), and the runtime container-secrets
endpoint (`laxclaws:src/app/api/internal/container-secrets/route.ts:91-93`). The gateway
reads the env var by exactly that name (`src/gateway/auth-token-resolution.ts:39`).

### WS connect handshake (captured)

1. On socket open the server immediately pushes:

```json
{"type":"event","event":"connect.challenge","payload":{"nonce":"f03fca68-1c0b-4662-81eb-14298ebd57e5","ts":1781095020722}}
```

2. The client's **first frame must be** a `connect` request. Required params
   (`frames.ts:20-71`): `minProtocol`/`maxProtocol` (**4**, `src/gateway/protocol/version.ts:1-3`)
   and `client {id, version, platform, mode}` (id/mode enums in
   `src/gateway/protocol/client-info.ts`; we used `gateway-client`/`backend`).
   Token goes in `params.auth.token`; `role` and `scopes` are *requested* here.

3. Success: `{type:"res", id, ok:true, payload:{type:"hello-ok", ...}}` carrying
   `auth.role`, `auth.scopes` (what you actually got), `features.methods/events`, and
   `snapshot.sessionDefaults` — incl. `mainSessionKey` (captured: `"agent:dev-commander:main"`),
   so the correct session key is discoverable from the handshake itself.

### ⚠ THE DEVICE-IDENTITY REQUIREMENT (the spike's key live finding)

**A remote token-auth client with no device identity connects fine but gets its scopes
CLEARED** — captured: `hello-ok.auth = {"role":"operator","scopes":[]}` and then
`chat.send` → `{"ok":false,"error":{"code":"INVALID_REQUEST","message":"missing scope: operator.write"}}`.
Scope-clearing rule: `shouldClearUnboundScopesForMissingDeviceIdentity`
(`src/gateway/server/ws-connection/connect-policy.ts:85-100` — token/password auth without
a device → clear). The loopback exemption upstream's CLI relies on does not apply to
remote clients (`src/gateway/call.ts` `shouldOmitDeviceIdentityForGatewayCall`;
`handshake-auth-helpers.ts` `shouldSkipLocalBackendSelfPairing` requires `direct_local` /
`shared_secret_loopback_local`).

**Working flow (fully captured):**

1. Generate a persistent **Ed25519 keypair**; `deviceId = sha256hex(raw 32-byte public key)`
   (`src/infra/device-identity.ts:63-104`). Public key travels as base64url of the raw key.
2. Sign the **v3 payload** (`src/gateway/device-auth.ts:36-53`) over the challenge nonce:

```
v3|<deviceId>|<clientId>|<clientMode>|<role>|<scopes,comma>|<signedAtMs>|<token>|<nonce>|<platform-lowercased>|<deviceFamily-lowercased>
```

   signature = base64url(Ed25519-sign(payload)); send in `params.device =
   {id, publicKey, signature, signedAt, nonce}`.
3. First connect with an unknown device → error res + close 1008:

```json
{"ok":false,"error":{"code":"NOT_PAIRED","message":"pairing required: device is not approved yet",
  "details":{"code":"PAIRING_REQUIRED","reason":"not-paired","requestId":"bff544bf-66a4-4657-a3bc-bb792d257f4d",
             "deviceId":"e9fce6e8…","requestedRole":"operator","requestedScopes":["operator.read","operator.write"]}}}
```

4. **Self-approve out-of-band via admin HTTP RPC** (same Bearer token) — captured:
   `device.pair.list` → pending entry with `requestId`; `device.pair.approve {requestId}` →
   `{"ok":true,"payload":{...,"device":{...,"scopes":["operator.read","operator.write"],"tokens":[...]}}}`.
5. Reconnects then yield `hello-ok.auth = {"role":"operator","scopes":["operator.read","operator.write"]}`
   plus a **`deviceToken`** for faster re-auth (`auth.deviceToken` in hello-ok; send it as
   `params.auth.deviceToken` on later connects).

### Failure envelopes (captured)

| Case | Behavior |
|---|---|
| Bad token | res `{"code":"INVALID_REQUEST","message":"unauthorized: gateway token mismatch (provide gateway auth token)","details":{"code":"AUTH_TOKEN_MISMATCH","authReason":"token_mismatch","canRetryWithDeviceToken":true}}` then **close 1008** |
| Unknown device | `NOT_PAIRED` / `PAIRING_REQUIRED` (above) then close 1008 |
| Gateway still starting | close **1013** (`src/gateway/protocol/startup-unavailable.ts:3-4`) — retryable |
| Gateway auth rotated mid-session | close **4001** (`message-handler.ts` "gateway auth changed") |
| Missing scope | error **res** on the method call (no close) — connection stays usable for read methods |

### DECISION RECORDED (for PR-9/A-vercel)

**Per-workspace encrypted device keypair column** (mirrors `gatewayToken` storage), not a
single deployment-wide identity. Rationale: blast radius — one compromised/rotated keypair
affects one workspace, and pairing state is per-gateway (per-container) regardless, so a
shared identity saves nothing: every workspace's gateway must pair (and re-pair after
hibernation wake → fresh container) individually. Pairing bootstrap must be idempotent
(§7, §8).

---

## 4. Inbound message contract

### `chat.send` params (`src/gateway/protocol/schema/logs-chat.ts:35-55`)

```json
{
  "sessionKey": "agent:<orchestrator-slug>:main",
  "message": "<user text>",
  "idempotencyKey": "<uuid — REQUIRED, non-empty>",
  "deliver": false
}
```

(Optional: `thinking`, `attachments`, `timeoutMs`, `originating*`. `deliver:false` is what
the Control UI itself sends — `ui/src/ui/controllers/chat.ts:424-428`.)

### Ack (captured)

```
12:55:58.191 ⇨ req chat.send {…, "idempotencyKey":"76e24c4f-…"}
12:55:58.5   ⇦ res {"ok":true,"payload":{"runId":"76e24c4f-ded5-4505-9fcb-058d2526d957","status":"started"}}
```

- **Acceptance-time ack**: 313/323/387/401ms across all captured sends — never blocks on
  the turn. A Vercel function can 202-and-close.
- **`runId` = the client-supplied `idempotencyKey`.** And the container-side
  `MESSAGE_RECEIVED` ActivityLog row carries it as `metadata.messageId`; the
  `TASK_START`/`TASK_COMPLETE` rows carry it as `metadata.runId` — a complete,
  zero-schema-change correlation chain from send → ack → ActivityLog → reply events.

### Idempotency (captured)

Same `idempotencyKey` sent twice, 4s apart: first res `{"runId":"76e24c4f-…","status":"started"}`,
second res `{"runId":"76e24c4f-…","status":"ok"}` — **one** agent run, **one** `MESSAGE_RECEIVED`
row. PR-9/A may retry sends blindly with the same key.

### Routing

`chat.send` resolves the agent **from the session key** — `resolveSessionAgentId` parses
`agent:<agentId>:<mainKey>` (`src/gateway/server-methods/chat.ts:2271-2304`,
`src/agents/agent-scope.ts:291-304`, key format `src/routing/session-key.ts:188-195`).
It **never consults `bindings`**. Live confirmation: the run executed on `dev-commander`
(the Orchestrator) — `TASK_START agentSlug=dev-commander`. The generator's
`channel:'*'` binding is a no-op; the Orchestrator receives traffic because the generator
sets `default: true` on it — see §8 and issue
[#117](https://github.com/Laxcorp-Research/claws/issues/117).

### WS-close survivability (captured — the architecture gate)

Long-turn soak with a real LLM (multi-step prompt, **6.0s turn**):

```
13:45:36.x  ⇨ chat.send (idempotencyKey 7ba631e0-…)   ack ok=true after 401ms
13:45:36.x  ⇣ WS CLOSED immediately
13:45:38.95 ActivityLog MESSAGE_RECEIVED  (channelId "webchat")
13:45:41.40 ActivityLog TASK_START   agent=dev-commander     ← run STARTS ~5s after close
13:45:47.44 ActivityLog TASK_COMPLETE (durationMs: 6047)     ← completes after close
            GET /sessions/agent:dev-commander:main/history → genuine assistant reply,
            stopReason "stop", usage {input:10, output:478, cost.total: $0.0259}
```

Dispatch is fully decoupled from the socket. **Connect-send-disconnect is safe.**

---

## 5. Reply contract

### What does NOT happen

`message_sent` hooks do **not** fire for webchat replies. Emission lives only in external
outbound delivery (`src/infra/outbound/deliver.ts:978-1015` via `deliverOutboundPayloads`);
webchat replies are broadcast as WS `chat` events (`src/gateway/server-methods/chat.ts:1925-1940`)
and never pass through that path. Live confirmation: zero `MESSAGE_SENT` ActivityLog rows
across all captured exchanges. **The existing activity wire does not deliver reply text today.**

### What DOES happen

1. **`message_received` fires** for every webchat send (`src/channels/plugins/dispatch-from-config.ts:1407-1416`)
   → our reporter writes the canonical user-message row (captured, full row in appendix A):
   `MESSAGE_RECEIVED` with `metadata.channelId:"webchat"`, `metadata.messageId = idempotencyKey`,
   `metadata.sessionKey`, `detail` = full message text.
2. **`before_agent_run` / `agent_end` fire transport-agnostically**
   (`src/agents/pi-embedded-runner/run/attempt.ts:3795-3814, 4525-4543`) → `TASK_START` /
   `TASK_COMPLETE` rows. Critically, the `agent_end` event payload includes
   **`messages: messagesSnapshot`** — the conversation including the assistant reply
   (verified in source at `attempt.ts:4529`; the same snapshot's content is what the
   history endpoint returns, captured below with the real reply).
3. **Held-open WS clients** receive the reply as pushed events (captured, T1c-redux):
   `agent` lifecycle `phase:"start"` → interleaved `agent` assistant-stream deltas +
   `chat` `state:"delta"` events (each carrying `deltaText` AND the cumulative
   `message.content[].text`) → `agent` lifecycle `phase:"end"` → terminal:

```json
{"type":"event","event":"chat","payload":{"runId":"134d899f-…","sessionKey":"agent:dev-commander:main",
  "seq":11,"state":"final","message":{"role":"assistant","content":[{"type":"text","text":"# Signs of an Oversized Pull Request\n\n## 1. **Covers Multiple Unrelated Features or Fixes**\n…"}]}}}
```

   (4.9s send→final on a real turn.)

### Recommended reply path (the PR-9/A contract)

**Extend `claws-activity-reporter`'s `agent_end` handler** to emit a reply ActivityLog row
for webchat-channel turns, sourcing the assistant text from the `messages` snapshot →
existing activity wire → existing SSE → dashboard. (This is PR-9/A-container: an overlay
image rebuild via the existing `force_version` suffix flow.)

**HARD REQUIREMENT — turn health on the reply row.** `agent_end`'s `success` flag (and
the resulting `TASK_COMPLETE`) is **true even for errored turns**: captured in Phase 2,
a turn whose LLM call failed (`authentication_error`) still produced
`TASK_COMPLETE {success:true, durationMs:268}` while the transcript recorded
`role:"assistant", stopReason:"error", errorMessage:"…invalid x-api-key…", content:"[assistant turn failed before producing content]"`.
The emitted reply row must carry `stopReason`/error state from the snapshot so the chat
panel can truthfully distinguish "answered" from "errored" — TASK_COMPLETE alone lies.

**Verified fallback / history hydration:** `GET /sessions/<sessionKEY>/history` (Bearer
token, plain HTTP — no WS, no pairing). Captured transcript item shapes:

```json
// user item
{"role":"user","content":[{"type":"text","text":"List three repo-hygiene checks …"}],
 "timestamp":1781099138…, "senderLabel":"gateway-client"}

// assistant item (healthy turn — REAL captured reply, truncated)
{"role":"assistant","content":[{"type":"text","text":"# Weekly Repo-Hygiene Checks\n\n## 1. **Dependency Security Scanning**\nRun automated vulnerability scans (e.g., `npm audit`, `cargo audit`, Dependabot)…"}],
 "api":"anthropic-messages","provider":"anthropic","model":"claude-haiku-4-5-20251001",
 "usage":{"input":10,"output":478,"totalTokens":19319,"cost":{"total":0.02593875}},
 "stopReason":"stop","timestamp":…}

// assistant item (errored turn — Phase 2 capture)
{"role":"assistant","content":[{"type":"text","text":"[assistant turn failed before producing content]"}],
 "stopReason":"error","errorMessage":"{\"type\":\"error\",\"error\":{\"type\":\"authentication_error\",…}}", "usage":{…,"cost":{"total":0}}}
```

Response truncation is tunable via `gateway.webchat.chatHistoryMaxChars` (default 12000,
`src/config/zod-schema.ts:964-968`).

---

## 6. Webchat surface

- **Not a `channels.*` type.** The channels zod schema has no webchat key
  (`src/config/zod-schema.channels-config.ts:51-68`); `"webchat"` is the gateway's internal
  message-surface name (`src/utils/message-channel-constants.ts:1` —
  `INTERNAL_MESSAGE_CHANNEL = "webchat"`).
- **Zero `openclaw.json` config required.** Webchat IS the gateway WS protocol; the
  Control UI's `/chat` page (`ui/src/ui/navigation.ts:61,144-146`) is just another WS
  client (`mode:"webchat"`, `app-gateway.ts:523-529`) calling `chat.history` /
  `chat.send {deliver:false}` / `chat.abort` and consuming pushed `chat` events.
  Our dashboard chat is a second client of the same surface.
- Only webchat-adjacent config: optional `gateway.webchat.chatHistoryMaxChars`
  (`src/config/types.gateway.ts:443-446`).
- Live `sessions.list` confirms the session's `origin.provider/surface = "webchat"`,
  `deliveryContext.channel = "webchat"`.

---

## 7. Recommended PR-9/A mechanism

**Send: short-lived WS connect-send-disconnect from the Vercel send function.**

Full frame sequence (every step captured; see appendix A for verbatim frames):

```
1. open  wss://<containerHost>                       (root path, no subprotocol)
2. ⇦ event connect.challenge {nonce, ts}
3. ⇨ req  connect {minProtocol:4, maxProtocol:4,
                   client:{id:"gateway-client", version:"<claws-version>", platform:"node", mode:"backend"},
                   role:"operator", scopes:["operator.read","operator.write"],
                   auth:{token:<OPENCLAW_GATEWAY_TOKEN>},          ← or deviceToken on re-auth
                   device:{id, publicKey, signature(v3 over nonce), signedAt, nonce}}
4. ⇦ res  ok:true payload hello-ok                   (auth.scopes MUST include operator.write;
                                                      sessionDefaults.mainSessionKey = target session)
5. ⇨ req  chat.send {sessionKey, message, idempotencyKey:<uuid>, deliver:false}
6. ⇦ res  ok:true payload {runId:<idempotencyKey>, status:"started"}   ← ~300-400ms; return 202 now
7. close 1000
```

- **Pairing bootstrap:** deploy-time or lazy-first-send; on `NOT_PAIRED` capture
  `details.requestId`, call admin HTTP RPC `device.pair.approve {requestId}` with the same
  Bearer token, reconnect. Must be **idempotent** (already-paired → connect just succeeds)
  and must tolerate re-pairing after any container replacement (redeploy, hibernation wake).
- **ActivityLog write strategy:** the container writes the canonical `MESSAGE_RECEIVED`
  (observed ~0.6s after send). **The send endpoint writes NOTHING.** The UI renders the
  user message optimistically and reconciles via `idempotencyKey == metadata.messageId`
  when the row arrives on SSE. (Note: `metadata` is currently excluded from the SSE wire
  by the PR-4d structural test — PR-9/B must extend `formatLog` + that test's exclusion
  list deliberately.)
- **Reply:** `agent_end` reporter extension (PR-9/A-container, overlay rebuild) emitting a
  reply row **with turn health** (§5 hard requirement); `GET /sessions/<key>/history` as
  the verified HTTP fallback and for history hydration/pagination.
- **Status gating:** destroyed container fails fast and unambiguously (§8) — detect
  synchronously in the send function.

**Rejected alternatives:**

| Alternative | Why rejected |
|---|---|
| HTTP admin RPC for send | No send-capable method in the 54-method allowlist (`extensions/admin-http-rpc/src/methods.ts:1-55`); allowlist is fixed at the plugin, not configurable |
| OpenAI-compatible HTTP endpoints (`/v1/chat/completions` style) | Synchronous — blocks until the turn completes; Orchestrator turns run 30s-2min+, Vercel function timeout makes this impossible (the non-negotiable Option B constraint). Also config-gated off by default |
| Container-side polling of a Claws "pending messages" endpoint | Adds poll latency + a new internal endpoint + container plugin when a verified push path exists; keep as a future fallback only |
| Persistent server-side WS (subscribe to `chat` events for replies) | Precluded by Vercel function lifetimes; that's what the `agent_end` reporter extension replaces |

---

## 8. Open risks

1. **Gateway-token reconciliation blind spot.** The env-reconciliation cron compares
   exactly three credential fields — `credit_mode`, `base_url`, `key_fp`
   (`laxclaws:src/app/api/cron/reconcile-container-env/route.ts:321-328`;
   `docs/CONTAINER_ENV_RECONCILIATION_CONTRACT.md:135`). `OPENCLAW_GATEWAY_TOKEN` is
   outside the contract: if the Railway value ever diverges from `Workspace.gatewayToken`,
   nothing detects it. Tolerable while the token only served the health monitor; **chat
   makes it load-bearing for a user-facing feature.** A one-line note in the reconciliation
   contract doc lands with PR-9/A.
2. **Dead `bindings` config.** `channel:'*'` is a no-op (binding index is keyed by exact
   channel string, `src/routing/resolve-route.ts:242-279,449`); Orchestrator routing
   actually works via `default: true` + default-agent fallback
   (`laxclaws:generator.ts:272-273`; `src/agents/agent-scope-config.ts:87-99`). Tracked as
   **[issue #117](https://github.com/Laxcorp-Research/claws/issues/117)** — generator fix
   is out of scope for this PR.
3. **Destroyed-container transport signature** (captured, T7): HTTPS →
   **HTTP 404 in ~670ms** with Railway-edge body
   `{"status":"error","code":404,"message":"Application not found","request_id":"…"}`;
   WSS → error event ("network error or non-101 status code") in **~440ms**, and Node's
   `WebSocket` emits `error` without a subsequent `close` event (handle both). This is the
   send endpoint's STOPPED/HIBERNATED detection contract: failure is sub-second and
   distinguishable from a starting gateway (close 1013) or a slow turn.
4. **`TASK_COMPLETE` success semantics.** `agent_end.success` is true even when the turn's
   LLM call errored (captured Phase 2). Any UI or reporter logic equating TASK_COMPLETE
   with "answered" is wrong; reply rows must carry `stopReason`/error state (§5).
5. **Device pairing adds a bootstrap state.** Pairing is per-gateway: every fresh container
   (first deploy, redeploy-after-stop, hibernation wake) starts with zero paired devices.
   PR-9/A's send path must treat `NOT_PAIRED` as a normal, recoverable state and self-approve
   idempotently — not as an error. Also note: hello-ok returns a `deviceToken` whose reuse
   avoids re-signing, but it dies with the container; the Ed25519 keypair is the durable
   credential.
6. **Local-tooling footnote** (affects probe reruns, not production): the probe machine's
   TLS-intercepting proxy requires `node --use-system-ca`; Vercel runtime is unaffected.

---

## Appendix A — Captured evidence (verbatim, token redacted)

### A.1 Successful connect (paired device)

```json
{"type":"req","id":"b788ad03-…","method":"connect","params":{"minProtocol":4,"maxProtocol":4,
 "client":{"id":"gateway-client","version":"spike-pr9-probe","platform":"node","mode":"backend"},
 "role":"operator","scopes":["operator.read","operator.write"],
 "auth":{"token":"<GATEWAY_TOKEN_REDACTED>"},
 "device":{"id":"e9fce6e8172371164b5dad4421f43461ed998d3881c8da4b599bb8ca353912f3",
           "publicKey":"HC9iSckJnr3_iD0AIINXH9pi_Bm7ISBIZrsMuQHcp1o",
           "signature":"<base64url-ed25519>","signedAt":1781095731673,
           "nonce":"f03fca68-1c0b-4662-81eb-14298ebd57e5"}}}
```

hello-ok (elided): `"auth":{"role":"operator","scopes":["operator.read","operator.write"],"deviceToken":"<REDACTED>","issuedAtMs":…}`,
`"snapshot":{"sessionDefaults":{"defaultAgentId":"dev-commander","mainSessionKey":"agent:dev-commander:main"},…}`

### A.2 Pairing self-approval over admin HTTP RPC

```json
// POST /api/v1/admin/rpc  {"method":"device.pair.list","params":{}}
{"ok":true,"payload":{"pending":[{"requestId":"bff544bf-66a4-4657-a3bc-bb792d257f4d",
  "deviceId":"e9fce6e8…","publicKey":"HC9iSck…","platform":"node","clientId":"gateway-client",
  "clientMode":"backend","role":"operator","scopes":["operator.read","operator.write"],"silent":false}],"paired":[]}}

// POST /api/v1/admin/rpc  {"method":"device.pair.approve","params":{"requestId":"bff544bf-…"}}
{"ok":true,"payload":{"requestId":"bff544bf-…","device":{"deviceId":"e9fce6e8…",
  "role":"operator","scopes":["operator.read","operator.write"],
  "tokens":[{"role":"operator","scopes":["operator.read","operator.write"],"createdAtMs":…}]}}}
```

### A.3 ActivityLog row sequence for one REAL exchange (T4-redux, staging DB)

```json
{"ts":"…45:38.950Z","type":"MESSAGE_RECEIVED","agentSlug":null,
 "action":"Received from : List three repo-hygiene checks a dev team should run weekly and explain each in two sentences.",
 "detail":"List three repo-hygiene checks a dev team should run weekly and explain each in two sentences.",
 "metadata":{"from":"","messageId":"7ba631e0-033a-46f9-ade7-839345efe8ce","senderId":"gateway-client",
             "runId":null,"sessionKey":"agent:dev-commander:main","channelId":"webchat","sourceAgentId":null}}

{"ts":"…45:41.398Z","type":"TASK_START","agentSlug":"dev-commander",
 "action":"Task started: Sender (untrusted metadata): … List three repo-hygiene checks …",
 "metadata":{"triggerKind":"task","runId":"7ba631e0-033a-46f9-ade7-839345efe8ce",
             "sessionKey":"agent:dev-commander:main","channelId":"webchat","sourceAgentId":"dev-commander"}}

{"ts":"…45:47.444Z","type":"TASK_COMPLETE","agentSlug":"dev-commander",
 "action":"Task completed in 6s",
 "metadata":{"success":true,"durationMs":6047,"runId":"7ba631e0-033a-46f9-ade7-839345efe8ce",
             "sessionKey":"agent:dev-commander:main","channelId":"webchat","sourceAgentId":"dev-commander"}}
```

No `MESSAGE_SENT` row exists — the reply reached the transcript (A.4) but not ActivityLog
(the PR-9/A-container gap this doc specifies the fix for).

### A.4 Real captured reply (history endpoint, same exchange)

`GET /sessions/agent:dev-commander:main/history` → 200; final item:
`role:"assistant"`, `stopReason:"stop"`, `model:"claude-haiku-4-5-20251001"`,
`usage:{"input":10,"output":478,"totalTokens":19319,"cost":{"total":0.02593875}}`, text beginning:

> \# Weekly Repo-Hygiene Checks
> \#\# 1. **Dependency Security Scanning** — Run automated vulnerability scans (e.g., `npm audit`, `cargo audit`, Dependabot)…

### A.5 Held-open reply stream (T1c-redux, 4.9s send→final)

```
⇦ event agent {stream:"lifecycle", data:{phase:"start"}}
⇦ event agent {stream:"assistant", data:{text:"# Signs of an Oversized Pull Request\n\n## 1. **Covers", delta:"…"}}
⇦ event chat  {state:"delta", deltaText:"…", message:{role:"assistant", content:[{type:"text", text:"<cumulative>"}]}}
   … (interleaved agent/chat deltas, ~200ms apart) …
⇦ event agent {stream:"lifecycle", data:{phase:"end", livenessState:"working"}}
⇦ event chat  {state:"final", message:{role:"assistant", content:[{type:"text", text:"<complete reply>"}]}}
```

### A.6 Errored-turn shapes (Phase 2, placeholder key — kept as the error contract)

```
⇦ event agent {stream:"lifecycle", data:{phase:"error", error:"LLM error authentication_error: invalid x-api-key", livenessState:"blocked"}}
⇦ event agent {stream:"lifecycle", data:{phase:"fallback_step", …, fallbackStepFinalOutcome:"chain_exhausted"}}
// transcript: {"role":"assistant","content":[{"type":"text","text":"[assistant turn failed before producing content]"}],
//              "stopReason":"error","errorMessage":"…authentication_error…"}
// ActivityLog: TASK_COMPLETE {success:true, durationMs:268}   ← §8 risk 4
```
