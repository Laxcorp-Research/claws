// Claws Activity Reporter — OpenClaw overlay plugin.
//
// Loaded by the OpenClaw gateway at /opt/claws-activity-reporter/ (path baked
// into the Docker image; activated via openclaw.json plugins.load.paths +
// plugins.entries.claws-activity-reporter.enabled, set by the Claws deployer).
//
// Wires 6 OpenClaw plugin hooks → Claws ActivityLog rows:
//
//   before_agent_run     → TASK_START
//   agent_end            → TASK_COMPLETE  (when event.success === true)
//                          TASK_FAILED    (otherwise)
//   message_received     → MESSAGE_RECEIVED
//   message_sent         → MESSAGE_SENT
//   after_tool_call      → SKILL_INVOKED  (when no error)
//                          ERROR          (when event.error)
//   cron_changed         → HEARTBEAT      (only if event.action==='started' AND
//                                          the job is a Claws-generated
//                                          heartbeat cron — see filter below)
//
// CRITICAL DESIGN INVARIANTS (regression-prone, do not break):
//
//   1. Handlers MUST be synchronous.
//      The OpenClaw void-hook runner (`hooks.ts:557-587` in upstream) wraps
//      handler returns in `Promise.resolve(...)` and `await Promise.all(...)`s
//      them under a per-hook timeout. If a handler `await`s a network POST,
//      the caller of `runVoidHook` blocks for that duration — which is the
//      agent turn. So our handler does ONE thing: `reporter.add(record)`.
//      That's an O(1) synchronous push. The actual HTTP POST happens later,
//      from a setInterval flusher that runs outside the hook call path.
//
//   2. Every hook registration carries opts {timeoutMs: 100}.
//      Defense-in-depth — even if a future regression introduces an `await`
//      inside a handler, the OpenClaw runner kills it at 100ms and continues.
//
//   3. UsageReporter buffer is copied verbatim from credit-proxy.mjs.
//      Same 500-record cap, same 10s flush interval, same 50/batch, same
//      re-queue-front-on-failure, same drop-oldest-with-counter overflow.
//
//   4. On SIGTERM the gateway fires `gateway_stop`; we register a handler
//      that flushes one final batch synchronously-as-possible (the hook
//      runner awaits it, but it's the shutdown path so blocking is fine).
//
// Auth: POST /api/internal/activity/<workspaceId> with header
// `X-Activity-Secret`. Endpoint validates the secret and the event-type
// subset (rejects SYSTEM / HUMAN_* / TRADE_* / REVIEW_* / etc. — those
// belong to other code paths). See src/app/api/internal/activity/[workspaceId]/route.ts.

// PR-1 (sync-now): on-demand runtime-state sync. Shared bundle/upload logic
// lives in ../state-sync.mjs (image: /opt/state-sync.mjs — see Dockerfile),
// the SAME module process-manager uses for its interval/SIGTERM syncs.
import { runStateSync } from "../state-sync.mjs";

const ENDPOINT_BASE = process.env.CLAWS_ACTIVITY_ENDPOINT;
const ACTIVITY_SECRET = process.env.CLAWS_ACTIVITY_SECRET;
const WORKSPACE_ID = process.env.CLAWS_WORKSPACE_ID;

const HANDLER_TIMEOUT_MS = 100;

const MAX_PENDING = 500;
const FLUSH_INTERVAL_MS = 10_000;
const BATCH_SIZE = 50;
const REQUEST_TIMEOUT_MS = 10_000;

// IMPORTANT — cross-reference to Claws generator.
// Heartbeat cron jobs are generated at
//   src/lib/openclaw/generator.ts:1521 (`name: \`orchestrator-heartbeat-${frequency}\``)
// If the name prefix is changed there, change it here too. The string is
// pinned in BOTH places so the coupling is greppable in either direction.
const HEARTBEAT_CRON_NAME_PREFIX = "orchestrator-heartbeat-";

function isHeartbeatJob(job) {
  // The `cron_changed` event delivers a `PluginHookGatewayCronJob` shape
  // (upstream hook-types.ts:706-738). We filter on the deterministic `name`
  // prefix Claws sets when generating the heartbeat cron — template-defined
  // scheduled tasks never use this prefix.
  return (
    job != null &&
    typeof job === "object" &&
    typeof job.name === "string" &&
    job.name.startsWith(HEARTBEAT_CRON_NAME_PREFIX)
  );
}

// ─── UsageReporter buffer (copied verbatim from container/credit-proxy.mjs) ───
//
// Behavior contract — must NOT be changed without updating credit-proxy.mjs
// in lockstep:
//   - `add(record)` is synchronous, O(1), and never awaits.
//   - When pending crosses BATCH_SIZE/2 we attempt a flush opportunistically
//     (still without awaiting in the caller path).
//   - On overflow we drop the OLDEST record, not the newest. The newest is
//     usually the more interesting signal (most recent state).
//   - On HTTP failure we re-queue at the FRONT (unshift) so order is
//     preserved on retry.
//   - On SIGTERM the gateway_stop hook calls `shutdown()` which awaits one
//     final flush.
class ActivityReporter {
  constructor() {
    this.pending = [];
    this.dropped = 0;
    this.flushInterval = null;
    this.shuttingDown = false;
  }

  start() {
    if (this.flushInterval) return;
    this.flushInterval = setInterval(() => {
      // setInterval callback runs OUT of the hook call path — this is the
      // only place we actually await the network POST.
      void this.flush();
    }, FLUSH_INTERVAL_MS);
    // Don't keep the event loop alive purely for our flusher.
    if (typeof this.flushInterval.unref === "function") this.flushInterval.unref();
  }

  add(record) {
    if (this.shuttingDown) return;
    if (this.pending.length >= MAX_PENDING) {
      this.pending.shift();
      this.dropped++;
      if (this.dropped % 50 === 0) {
        // Visibility for sustained overflow without spamming logs.
        console.warn(`[claws-activity-reporter] dropped ${this.dropped} records (buffer full)`);
      }
    }
    this.pending.push(record);
    // Mirror credit-proxy: opportunistic flush at ~half batch. Note we
    // DON'T await — the flush runs as a microtask out of the hook path.
    if (this.pending.length >= BATCH_SIZE) {
      void this.flush();
    }
  }

  async flush() {
    if (!ENDPOINT_BASE || !ACTIVITY_SECRET || !WORKSPACE_ID) {
      // Not configured — drop silently. Don't fill the buffer indefinitely.
      this.pending.length = 0;
      return;
    }
    if (this.pending.length === 0) return;

    const batch = this.pending.splice(0, BATCH_SIZE);
    const url = `${ENDPOINT_BASE.replace(/\/$/, "")}/${encodeURIComponent(WORKSPACE_ID)}`;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Activity-Secret": ACTIVITY_SECRET,
        },
        body: JSON.stringify({ events: batch }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (res.ok) {
        this.dropped = 0;
        return;
      }
      // 4xx is OUR fault (malformed payload, bad secret). Don't re-queue —
      // re-queueing a malformed batch would loop forever. Log + drop.
      // 5xx / network errors → re-queue at the front for retry.
      if (res.status >= 400 && res.status < 500) {
        console.warn(
          `[claws-activity-reporter] dropping ${batch.length} records: server returned ${res.status}`,
        );
        return;
      }
      this.pending.unshift(...batch);
    } catch (err) {
      // Network/timeout/abort — re-queue and retry on the next interval.
      this.pending.unshift(...batch);
      console.warn(
        `[claws-activity-reporter] flush failed (${err?.message ?? String(err)}); ${batch.length} records re-queued`,
      );
    }
  }

  async shutdown() {
    this.shuttingDown = true;
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    try {
      await this.flush();
    } catch {
      // Best effort on shutdown.
    }
  }
}

const reporter = new ActivityReporter();

/**
 * -8 emission-version boot stamp. Synchronous enqueue only (hook invariant).
 * Uses TASK_START (allowed ingest type) with metadata.clawsOverlaySha.
 */
export function emitOverlayBootEvent() {
  const sha =
    typeof process.env.CLAWS_OVERLAY_SHA === "string" && process.env.CLAWS_OVERLAY_SHA.length > 0
      ? process.env.CLAWS_OVERLAY_SHA
      : null;
  reporter.add({
    type: "TASK_START",
    timestamp: new Date().toISOString(),
    agentId: null,
    runId: null,
    sessionKey: null,
    channelId: null,
    action: "Claws overlay boot",
    detail: sha ? `CLAWS_OVERLAY_SHA=${sha}` : "CLAWS_OVERLAY_SHA unset",
    metadata: {
      eventKind: "overlay_boot",
      clawsOverlaySha: sha,
    },
  });
}

// ─── Event marshalling helpers ───────────────────────────────────────────
//
// Each helper returns the ActivityLog-shaped record we POST. agentSlug is
// resolved server-side from the workspace's Agent rows (the plugin doesn't
// know agent slugs — only agentId from the hook ctx).

function buildBaseRecord(actionType, ctx, extraMetadata) {
  return {
    type: actionType,
    timestamp: new Date().toISOString(),
    agentId: typeof ctx?.agentId === "string" ? ctx.agentId : null,
    runId: typeof ctx?.runId === "string" ? ctx.runId : null,
    sessionKey: typeof ctx?.sessionKey === "string" ? ctx.sessionKey : null,
    channelId: typeof ctx?.channelId === "string" ? ctx.channelId : null,
    action: "",
    // PR-4: `action` is a SHORT human-readable summary; `detail` (set per
    // handler, optional) holds the full untruncated context for the
    // dashboard's expand-on-click. Default undefined → no detail row.
    detail: undefined,
    metadata: { ...extraMetadata },
  };
}

// Truncate human-readable strings before posting. We never want the full
// content of an agent prompt or model response in ActivityLog.action —
// the activity feed shows a short preview, transcripts live elsewhere.
// Collapses internal whitespace (single-line action text).
function truncate(s, max = 240) {
  if (typeof s !== "string") return "";
  const trimmed = s.trim().replace(/\s+/g, " ");
  return trimmed.length <= max ? trimmed : trimmed.substring(0, max - 1) + "…";
}

// PR-4: short cap for the inline action preview; full text goes to `detail`.
const ACTION_PREVIEW_MAX = 100;
// PR-4: detail cap (the endpoint hard-rejects > 4096; stay under it).
const DETAIL_MAX = 4000;

// Length-cap WITHOUT collapsing internal whitespace — `detail` preserves the
// original formatting (newlines, the [cron:...] trace prefix, stack traces).
// Returns undefined for empty/non-string so the record omits the field.
function clip(s, max = DETAIL_MAX) {
  if (typeof s !== "string") return undefined;
  const t = s.trim();
  if (t.length === 0) return undefined;
  return t.length <= max ? t : t.substring(0, max - 1) + "…";
}

// PR-9/A: clip() variant that REPORTS whether it truncated, for the reply
// row's metadata.truncated flag (contract C3: never silently cut). Same
// semantics as clip() otherwise; clip() itself and its call sites are
// deliberately untouched.
function clipWithFlag(s, max = DETAIL_MAX) {
  if (typeof s !== "string") return { text: undefined, truncated: false };
  const t = s.trim();
  if (t.length === 0) return { text: undefined, truncated: false };
  if (t.length <= max) return { text: t, truncated: false };
  return { text: t.substring(0, max - 1) + "…", truncated: true };
}

// PR-4: the cron-JOB-ID prefix Claws' generator uses for the orchestrator
// heartbeat — `heartbeat-${slug}-${frequency}` (and `...-test_5min`). Distinct
// from HEARTBEAT_CRON_NAME_PREFIX above (the job NAME prefix). The
// before_agent_run hook context carries ctx.jobId for cron-triggered runs
// (upstream propagates it — verified against v2026.5.22
// run.before-agent-reply-cron.test.ts), so we detect a heartbeat-triggered
// agent turn STRUCTURALLY rather than string-matching the prompt.
// CROSS-REFERENCE: src/lib/openclaw/generator.ts emits `id: heartbeat-...`.
const HEARTBEAT_CRON_ID_PREFIX = "heartbeat-";

// Classify what triggered a before_agent_run, so TASK_START gets a human
// action instead of dumping the raw (often engineer-only) prompt. Prefers the
// structured hook context (ctx.jobId / ctx.trigger); falls back to the cron
// trace prefix OpenClaw prepends to the delivered prompt: "[cron:<id> <name>]".
function classifyTrigger(event, ctx) {
  const jobId =
    typeof ctx?.jobId === "string" ? ctx.jobId
      : typeof event?.jobId === "string" ? event.jobId
        : "";
  const trigger = typeof ctx?.trigger === "string" ? ctx.trigger : "";
  const prompt = typeof event?.prompt === "string" ? event.prompt : "";

  if (jobId.startsWith(HEARTBEAT_CRON_ID_PREFIX)) return "heartbeat";
  if (prompt.startsWith("[cron:") && prompt.includes(HEARTBEAT_CRON_NAME_PREFIX)) return "heartbeat";
  // Any other cron-triggered run (a template-defined scheduled task).
  if (trigger === "cron" || jobId.length > 0 || prompt.startsWith("[cron:")) return "cron";
  return "task";
}

function handleBeforeAgentRun(event, ctx) {
  const fullPrompt = typeof event?.prompt === "string" ? event.prompt : "";
  const triggerKind = classifyTrigger(event, ctx);
  // promptPreview kept in metadata for backward compat (240, single-line).
  const promptPreview = truncate(fullPrompt);
  const record = buildBaseRecord("TASK_START", ctx, {
    triggerKind,
    promptPreview,
    senderId: typeof event?.senderId === "string" ? event.senderId : undefined,
    accountId: typeof event?.accountId === "string" ? event.accountId : undefined,
    jobId: typeof ctx?.jobId === "string" ? ctx.jobId : undefined,
  });
  // PR-4: SHORT human action. A heartbeat-triggered run is pure plumbing
  // ("[cron:...] Read HEARTBEAT.md ...") — collapse it to a label and stash
  // the raw prompt in detail. A real channel/user task keeps a short preview.
  if (triggerKind === "heartbeat") {
    record.action = "Heartbeat check";
  } else if (triggerKind === "cron") {
    record.action = "Scheduled task started";
  } else {
    const shortPreview = truncate(fullPrompt, ACTION_PREVIEW_MAX);
    record.action = shortPreview ? `Task started: ${shortPreview}` : "Task started";
  }
  record.detail = clip(fullPrompt);
  reporter.add(record);
}

// ─── PR-9/A: webchat reply-row emission (contract C1–C5) ──────────────────
//
// Dashboard chat replies never reach the activity wire by themselves:
// `message_sent` only fires for EXTERNAL outbound delivery (upstream
// deliver.ts), while webchat replies go out as gateway WS `chat` events. The
// reply text IS present in agent_end's `messages` snapshot, so we emit a
// MESSAGE_SENT row from here for webchat turns. Full protocol evidence:
// docs/OPENCLAW_GATEWAY_PROTOCOL.md §5/§7.

// C1 detection. Each leg is evidence-backed (PR-9/A-container Phase A audit):
//   - channelId === "webchat": agent_end ctx carries the run's originating
//     channel via upstream buildAgentHookContextChannelFields (derived from
//     the run's own message params, NOT the session's lastChannel) — verified
//     live: spike TASK_COMPLETE rows carried metadata.channelId "webchat".
//   - trigger gates: cron-executor runs carry trigger "cron", interval
//     heartbeats trigger "heartbeat" (upstream run-executor.ts:194,
//     attempt.prompt-helpers.ts:134). A heartbeat on the SAME main session
//     must not look like a chat reply (C5).
//   - subagent gate: sessions_spawn worker runs carry ":subagent:" in their
//     session key (upstream subagent-registry.ts) and may inherit message
//     context — only the top-level turn answers the user (C5).
function isWebchatReplyTurn(ctx) {
  return (
    ctx?.channelId === "webchat" &&
    ctx?.trigger !== "cron" &&
    ctx?.trigger !== "heartbeat" &&
    !String(ctx?.sessionKey ?? "").includes(":subagent:")
  );
}

// C2/C4 extraction rule (mirrors upstream's own lastAssistant selection in
// attempt.ts): last role==="assistant" item; text = type==="text" content
// blocks concatenated in array order; stopReason/errorMessage/usage from that
// same item. Errored turns persist a synthetic assistant item with
// stopReason "error" (captured live in the PR-9/0 spike), so they still
// yield a row. If NO assistant item exists (crash before any message
// persisted), fall back to the event's error so C4 still holds.
function extractAssistantReply(messages, event) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i--) {
    const m = list[i];
    if (m && typeof m === "object" && m.role === "assistant") {
      const blocks = Array.isArray(m.content) ? m.content : [];
      const text = blocks
        .filter((b) => b && typeof b === "object" && b.type === "text" && typeof b.text === "string")
        .map((b) => b.text)
        .join("\n");
      return {
        text,
        stopReason: typeof m.stopReason === "string" ? m.stopReason : undefined,
        errorMessage: typeof m.errorMessage === "string" ? m.errorMessage : undefined,
        usage: m.usage && typeof m.usage === "object" ? m.usage : undefined,
      };
    }
  }
  const eventError = typeof event?.error === "string" && event.error.length > 0 ? event.error : "";
  return {
    text: eventError || "(no reply produced)",
    stopReason: undefined,
    errorMessage: eventError || "(no assistant message in snapshot)",
    usage: undefined,
  };
}

function handleAgentEnd(event, ctx) {
  // PR-2 stub (Finding B fidelity telemetry): servedModel is NOT overlay-reachable
  // on agent_end today — ctx exposes agentId/runId/sessionKey/channelId/jobId/trigger
  // only; assistant message snapshot used here carries text/stopReason/usage, not
  // modelId. Do NOT invent a field. Next PR: confirm upstream hook payload (or
  // session store) surfaces the resolved model, then emit servedModel into
  // metadata (column-free JSON) so Watchtower can reconcile config-vs-served.
  const success = event?.success === true;
  const actionType = success ? "TASK_COMPLETE" : "TASK_FAILED";
  const fullError = typeof event?.error === "string" ? event.error : "";
  const record = buildBaseRecord(actionType, ctx, {
    success,
    durationMs: typeof event?.durationMs === "number" ? event.durationMs : undefined,
    error: fullError ? truncate(fullError) : undefined,
  });
  if (success) {
    const durationSec = record.metadata.durationMs
      ? ` in ${Math.round(record.metadata.durationMs / 100) / 10}s`
      : "";
    record.action = `Task completed${durationSec}`;
  } else {
    // PR-4: short error in the action, full error text in detail.
    const shortErr = truncate(fullError, ACTION_PREVIEW_MAX);
    record.action = shortErr ? `Task failed: ${shortErr}` : "Task failed";
    record.detail = clip(fullError);
  }
  reporter.add(record);

  // PR-9/A: ONE additional MESSAGE_SENT reply row for webchat turns —
  // emitted AFTER the (unchanged) TASK_COMPLETE/TASK_FAILED record. agent_end
  // fires once per run, so C1's "exactly one" holds by construction.
  if (!isWebchatReplyTurn(ctx)) return;

  const reply = extractAssistantReply(event?.messages, event);
  // C2 HARD REQUIREMENT: turn health from the transcript's error state —
  // NEVER from event.success (which is true even for errored turns; captured
  // live in the PR-9/0 spike, doc §8 risk 4).
  const turnHealth =
    reply.stopReason === "error" || reply.errorMessage || fullError ? "error" : "ok";
  const { text: detail, truncated } = clipWithFlag(
    turnHealth === "error" && !reply.text ? reply.errorMessage ?? "" : reply.text,
  );
  // C2: usage trimmed to exactly these four keys (metadata only — the ingest
  // route owns apiCost and hard-codes it null; PR-2b scope).
  const usage = reply.usage
    ? {
        input: typeof reply.usage.input === "number" ? reply.usage.input : undefined,
        output: typeof reply.usage.output === "number" ? reply.usage.output : undefined,
        totalTokens: typeof reply.usage.totalTokens === "number" ? reply.usage.totalTokens : undefined,
        costTotal:
          reply.usage.cost && typeof reply.usage.cost.total === "number"
            ? reply.usage.cost.total
            : undefined,
      }
    : undefined;

  const replyRecord = buildBaseRecord("MESSAGE_SENT", ctx, {
    to: "webchat",
    stopReason: reply.stopReason,
    turnHealth,
    truncated,
    usage,
  });
  const preview = truncate(reply.text || reply.errorMessage || "", ACTION_PREVIEW_MAX);
  replyRecord.action =
    turnHealth === "error"
      ? `Reply failed${preview ? `: ${preview}` : ""}`
      : preview
        ? `Replied: ${preview}`
        : "Replied";
  replyRecord.detail = detail;
  reporter.add(replyRecord);
}

function handleMessageReceived(event, ctx) {
  const from = typeof event?.from === "string" ? event.from : "(unknown)";
  const fullContent = typeof event?.content === "string" ? event.content : "";
  const preview = truncate(fullContent, ACTION_PREVIEW_MAX);
  const record = buildBaseRecord("MESSAGE_RECEIVED", ctx, {
    from,
    threadId: event?.threadId,
    messageId: typeof event?.messageId === "string" ? event.messageId : undefined,
    senderId: typeof event?.senderId === "string" ? event.senderId : undefined,
  });
  // PR-4: short preview in action, full message body in detail.
  record.action = preview ? `Received from ${from}: ${preview}` : `Received a message from ${from}`;
  record.detail = clip(fullContent);
  reporter.add(record);
}

function handleMessageSent(event, ctx) {
  const to = typeof event?.to === "string" ? event.to : "(unknown)";
  const fullContent = typeof event?.content === "string" ? event.content : "";
  const preview = truncate(fullContent, ACTION_PREVIEW_MAX);
  const success = event?.success === true;
  const fullError = typeof event?.error === "string" ? event.error : "";
  const record = buildBaseRecord("MESSAGE_SENT", ctx, {
    to,
    success,
    messageId: typeof event?.messageId === "string" ? event.messageId : undefined,
    error: fullError ? truncate(fullError) : undefined,
  });
  if (success) {
    record.action = preview ? `Sent to ${to}: ${preview}` : `Sent a message to ${to}`;
    record.detail = clip(fullContent);
  } else {
    const shortErr = truncate(fullError, ACTION_PREVIEW_MAX);
    record.action = `Send to ${to} failed${shortErr ? `: ${shortErr}` : ""}`;
    record.detail = clip(fullError);
  }
  reporter.add(record);
}

function handleAfterToolCall(event, ctx) {
  const toolName = typeof event?.toolName === "string" ? event.toolName : "(unknown)";
  const errored = typeof event?.error === "string" && event.error.length > 0;
  const fullError = errored ? event.error : "";
  const actionType = errored ? "ERROR" : "SKILL_INVOKED";
  const record = buildBaseRecord(actionType, ctx, {
    toolName,
    durationMs: typeof event?.durationMs === "number" ? event.durationMs : undefined,
    toolCallId: typeof event?.toolCallId === "string" ? event.toolCallId : undefined,
    error: errored ? truncate(fullError) : undefined,
  });
  if (errored) {
    // PR-4: short error in action, full error text in detail.
    const shortErr = truncate(fullError, ACTION_PREVIEW_MAX);
    record.action = `Tool ${toolName} failed${shortErr ? `: ${shortErr}` : ""}`;
    record.detail = clip(fullError);
  } else {
    record.action = `Tool ${toolName} invoked`;
  }
  reporter.add(record);
}

function handleCronChanged(event, ctx) {
  // Only "started" + heartbeat jobs become HEARTBEAT activity. Other cron
  // events (added/updated/removed/finished, non-heartbeat jobs) are ignored
  // by this plugin — they're not user-visible activity.
  if (event?.action !== "started") return;
  if (!isHeartbeatJob(event?.job)) return;

  const record = buildBaseRecord("HEARTBEAT", ctx, {
    jobId: typeof event?.jobId === "string" ? event.jobId : undefined,
    runAtMs: typeof event?.runAtMs === "number" ? event.runAtMs : undefined,
    nextRunAtMs: typeof event?.nextRunAtMs === "number" ? event.nextRunAtMs : undefined,
  });
  // The agent context for cron_changed is PluginHookGatewayContext, not
  // PluginHookAgentContext — so agentId may be missing. Use event.agentId
  // (mirrored on the cron payload) as the fallback.
  if (!record.agentId && typeof event?.agentId === "string") {
    record.agentId = event.agentId;
  }
  record.action = "Heartbeat tick";
  reporter.add(record);
}

// ─── PR-1: POST /internal/sync-now — backend-triggered confirmed sync ─────
//
// The Claws backend's syncThenDestroy (Stop + hibernate, PR-2) calls this
// BEFORE deleting the container, so "your history is saved" is a guarantee, not
// best-effort. Mechanism = a plugin HTTP route (registerHttpRoute, auth:"plugin")
// on the gateway port — the only externally-reachable surface. auth:"plugin"
// means the gateway does NOT require its own token; we authenticate the request
// ourselves with the shared CLAWS_METERING_SECRET (== backend METERING_MASTER_
// SECRET, deployer.ts:525) — same secret family as /api/internal/state/upload.
//
// Returns 200 ONLY when the snapshot is CONFIRMED persisted (server count>=1),
// or when there is genuinely nothing to sync (empty data dir — vacuously safe).
// Anything else is non-2xx so the backend knows the snapshot is NOT guaranteed
// current and can surface "recent activity may not be saved" (it still completes
// the Stop — see PR-2; we never trap the container).
//
// ACCEPTED BENIGN RACE: runStateSync()'s in-flight guard is PER-PROCESS, so a
// route-triggered sync here (gateway process) is not coordinated with
// process-manager's 5-min interval (parent process). That's fine — uploads are
// atomic single-column writes (no torn row; equal-or-fresher only), and on the
// Stop path the container is deleted right after this 200, stopping the
// interval. See the full invariant note in state-sync.mjs.
function readMeteringSecret() {
  return process.env.CLAWS_METERING_SECRET;
}

async function handleSyncNow(req, res) {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, error: "method_not_allowed" }));
    return true;
  }

  const expected = readMeteringSecret();
  const provided = req.headers["x-metering-secret"];
  // Fail-closed: an unconfigured secret must never accept any caller.
  if (!expected || provided !== expected) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, error: "unauthorized" }));
    return true;
  }

  let result;
  try {
    result = await runStateSync();
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, status: "error", error: err?.message ?? String(err) }));
    return true;
  }

  // 200 ONLY on a confirmed persist (count>=1) or a genuinely empty data dir
  // (nothing to persist → vacuously saved). Everything else is non-2xx.
  if (result.status === "persisted") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true, persisted: true, count: result.count, fileCount: result.fileCount }));
    return true;
  }
  if (result.status === "empty") {
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true, persisted: false, empty: true }));
    return true;
  }

  // rejected / accepted-unconfirmed / error / unconfigured → not guaranteed.
  res.statusCode = result.status === "rejected" ? 502 : 503;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ ok: false, status: result.status }));
  return true;
}

// ─── definePluginEntry-equivalent default export ─────────────────────────
//
// We deliberately do NOT import `definePluginEntry` from upstream because
// our plugin lives at /opt/claws-activity-reporter/ and can't resolve
// `openclaw/plugin-sdk/plugin-entry` from there. `definePluginEntry` is a
// thin helper that returns the same fields you pass in (upstream
// `src/plugin-sdk/plugin-entry.ts:303-328`), so the plain-object shape
// loads identically through `unwrapDefaultModuleExport`.

const pluginEntry = {
  id: "claws-activity-reporter",
  name: "Claws Activity Reporter",
  description: "Reports agent lifecycle events to the Claws control plane.",
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },
  // Bound at module load time. `register(api)` is the upstream contract
  // (`api: OpenClawPluginApi` per `src/plugins/types.ts:2870-2874`).
  register(api) {
    // Every void-hook handler MUST be synchronous. See the design invariant
    // at the top of this file. The 100ms registration timeout is
    // defense-in-depth — if any handler ever does an `await`, the upstream
    // hook runner kills it instead of stalling the agent turn.
    api.on("before_agent_run", handleBeforeAgentRun, { timeoutMs: HANDLER_TIMEOUT_MS });
    api.on("agent_end", handleAgentEnd, { timeoutMs: HANDLER_TIMEOUT_MS });
    api.on("message_received", handleMessageReceived, { timeoutMs: HANDLER_TIMEOUT_MS });
    api.on("message_sent", handleMessageSent, { timeoutMs: HANDLER_TIMEOUT_MS });
    api.on("after_tool_call", handleAfterToolCall, { timeoutMs: HANDLER_TIMEOUT_MS });
    api.on("cron_changed", handleCronChanged, { timeoutMs: HANDLER_TIMEOUT_MS });

    // Gateway lifecycle: start the periodic flusher when the gateway starts,
    // and drain one final batch on shutdown.
    api.on(
      "gateway_start",
      () => {
        reporter.start();
        // -8 emission-version: stamp CLAWS_OVERLAY_SHA (baked at image build)
        // onto a boot event so operators can see which overlay is running.
        emitOverlayBootEvent();
      },
      { timeoutMs: HANDLER_TIMEOUT_MS },
    );
    api.on(
      "gateway_stop",
      async () => {
        // Shutdown is allowed to await; the gateway is already terminating.
        await reporter.shutdown();
      },
      // gateway_stop has no default timeout per upstream
      // `hooks.ts:193-218`; a generous one here lets the final flush
      // actually drain.
      { timeoutMs: 5_000 },
    );

    // PR-1: backend-triggered confirmed pre-destroy sync. auth:"plugin" → the
    // gateway passes the raw request to our handler (no gateway token); we
    // validate CLAWS_METERING_SECRET ourselves. Exact match on a non-reserved
    // path (only "/api/channels" is gateway-protected). Route handlers MAY
    // await (unlike the void-hooks above).
    api.registerHttpRoute({
      path: "/internal/sync-now",
      auth: "plugin",
      match: "exact",
      handler: handleSyncNow,
    });
  },
};

export default pluginEntry;

// ─── Exposed for unit tests only ─────────────────────────────────────────
// The tests in src/__tests__/claws-activity-reporter.test.ts (vitest, repo
// root) import these to assert the marshalling logic + the sync-handler
// invariant. NOT part of the runtime surface used by OpenClaw.
export const __test__ = {
  ActivityReporter,
  reporter,
  isHeartbeatJob,
  HEARTBEAT_CRON_NAME_PREFIX,
  HEARTBEAT_CRON_ID_PREFIX,
  HANDLER_TIMEOUT_MS,
  ACTION_PREVIEW_MAX,
  DETAIL_MAX,
  handleBeforeAgentRun,
  handleAgentEnd,
  handleMessageReceived,
  handleMessageSent,
  handleAfterToolCall,
  handleCronChanged,
  truncate,
  clip,
  clipWithFlag,
  classifyTrigger,
  isWebchatReplyTurn,
  extractAssistantReply,
  handleSyncNow,
  emitOverlayBootEvent,
};
