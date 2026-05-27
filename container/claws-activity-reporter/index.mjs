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
    metadata: { ...extraMetadata },
  };
}

// Truncate human-readable strings before posting. We never want the full
// content of an agent prompt or model response in ActivityLog.action —
// the activity feed shows a short preview, transcripts live elsewhere.
function truncate(s, max = 240) {
  if (typeof s !== "string") return "";
  const trimmed = s.trim().replace(/\s+/g, " ");
  return trimmed.length <= max ? trimmed : trimmed.substring(0, max - 1) + "…";
}

function handleBeforeAgentRun(event, ctx) {
  const promptPreview = truncate(event?.prompt ?? "");
  const record = buildBaseRecord("TASK_START", ctx, {
    promptPreview,
    senderId: typeof event?.senderId === "string" ? event.senderId : undefined,
    accountId: typeof event?.accountId === "string" ? event.accountId : undefined,
  });
  record.action = `Task started: ${promptPreview || "(no prompt)"}`;
  reporter.add(record);
}

function handleAgentEnd(event, ctx) {
  const success = event?.success === true;
  const actionType = success ? "TASK_COMPLETE" : "TASK_FAILED";
  const record = buildBaseRecord(actionType, ctx, {
    success,
    durationMs: typeof event?.durationMs === "number" ? event.durationMs : undefined,
    error: typeof event?.error === "string" ? truncate(event.error) : undefined,
  });
  if (success) {
    const durationSec = record.metadata.durationMs
      ? ` in ${Math.round(record.metadata.durationMs / 100) / 10}s`
      : "";
    record.action = `Task completed${durationSec}`;
  } else {
    record.action = record.metadata.error
      ? `Task failed: ${record.metadata.error}`
      : "Task failed";
  }
  reporter.add(record);
}

function handleMessageReceived(event, ctx) {
  const from = typeof event?.from === "string" ? event.from : "(unknown)";
  const preview = truncate(event?.content ?? "", 120);
  const record = buildBaseRecord("MESSAGE_RECEIVED", ctx, {
    from,
    threadId: event?.threadId,
    messageId: typeof event?.messageId === "string" ? event.messageId : undefined,
    senderId: typeof event?.senderId === "string" ? event.senderId : undefined,
  });
  record.action = `Received from ${from}: ${preview}`;
  reporter.add(record);
}

function handleMessageSent(event, ctx) {
  const to = typeof event?.to === "string" ? event.to : "(unknown)";
  const preview = truncate(event?.content ?? "", 120);
  const success = event?.success === true;
  const record = buildBaseRecord("MESSAGE_SENT", ctx, {
    to,
    success,
    messageId: typeof event?.messageId === "string" ? event.messageId : undefined,
    error: typeof event?.error === "string" ? truncate(event.error) : undefined,
  });
  record.action = success
    ? `Sent to ${to}: ${preview}`
    : `Send to ${to} failed: ${record.metadata.error ?? "unknown error"}`;
  reporter.add(record);
}

function handleAfterToolCall(event, ctx) {
  const toolName = typeof event?.toolName === "string" ? event.toolName : "(unknown)";
  const errored = typeof event?.error === "string" && event.error.length > 0;
  const actionType = errored ? "ERROR" : "SKILL_INVOKED";
  const record = buildBaseRecord(actionType, ctx, {
    toolName,
    durationMs: typeof event?.durationMs === "number" ? event.durationMs : undefined,
    toolCallId: typeof event?.toolCallId === "string" ? event.toolCallId : undefined,
    error: errored ? truncate(event.error) : undefined,
  });
  record.action = errored
    ? `Tool ${toolName} failed: ${record.metadata.error}`
    : `Tool ${toolName} invoked`;
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
  },
};

export default pluginEntry;

// ─── Exposed for unit tests only ─────────────────────────────────────────
// The tests in __tests__/event-mapping.test.js import these to assert the
// marshalling logic + the sync-handler invariant. NOT part of the runtime
// surface used by OpenClaw.
export const __test__ = {
  ActivityReporter,
  reporter,
  isHeartbeatJob,
  HEARTBEAT_CRON_NAME_PREFIX,
  HANDLER_TIMEOUT_MS,
  handleBeforeAgentRun,
  handleAgentEnd,
  handleMessageReceived,
  handleMessageSent,
  handleAfterToolCall,
  handleCronChanged,
  truncate,
};
