// PR-2: tests for the in-container `claws-activity-reporter` plugin.
//
// The plugin itself lives outside `src/` (at `container/claws-activity-reporter/`)
// because it's baked into the Docker image, not imported by the Next.js app.
// This test file lives under `src/__tests__/` because vitest's `include`
// pattern in vitest.config.ts only picks up `src/**/*.test.ts`. The plugin
// is imported via a relative path.
//
// Two contracts under test:
//
//   1. EVENT MAPPING - each of the 6 hook handlers produces the right
//      ActivityType + action shape from a representative hook payload.
//      Payload shapes verified against upstream OpenClaw v2026.5.22 source
//      (tmp/openclaw-src/src/plugins/hook-types.ts and hook-message.types.ts).
//
//   2. SYNC HANDLER INVARIANT - every handler must return SYNCHRONOUSLY
//      (not a Promise). The upstream void-hook runner wraps returns in
//      Promise.resolve() and awaits all of them under per-hook timeouts -
//      so a handler that returns a pending Promise would delay the agent
//      turn until the underlying buffer/network resolved. This test asserts
//      that `handler(event, ctx)` returns `undefined`, not a Promise-like
//      thenable.
//
// We import via the plugin's __test__ named export (not the default export
// which is the plugin manifest object).

import { describe, it, expect, beforeEach, vi } from "vitest";

interface ActivityRecord {
  type: string;
  agentId: string | null;
  runId: string | null;
  action: string;
  detail?: string;
  metadata: Record<string, unknown>;
}

interface PluginTestSurface {
  ActivityReporter: new () => {
    pending: ActivityRecord[];
    dropped: number;
    add: (rec: ActivityRecord) => void;
    flush: () => Promise<void>;
    shutdown: () => Promise<void>;
  };
  reporter: { pending: ActivityRecord[]; dropped: number };
  isHeartbeatJob: (job: unknown) => boolean;
  HEARTBEAT_CRON_NAME_PREFIX: string;
  HEARTBEAT_CRON_ID_PREFIX: string;
  HANDLER_TIMEOUT_MS: number;
  ACTION_PREVIEW_MAX: number;
  DETAIL_MAX: number;
  handleBeforeAgentRun: (event: unknown, ctx: unknown) => void;
  handleAgentEnd: (event: unknown, ctx: unknown) => void;
  handleMessageReceived: (event: unknown, ctx: unknown) => void;
  handleMessageSent: (event: unknown, ctx: unknown) => void;
  handleAfterToolCall: (event: unknown, ctx: unknown) => void;
  handleCronChanged: (event: unknown, ctx: unknown) => void;
  truncate: (s: unknown, max?: number) => string;
  clip: (s: unknown, max?: number) => string | undefined;
  classifyTrigger: (event: unknown, ctx: unknown) => string;
}

// Module-scope singleton captured by all the handlers in index.mjs.
// We don't try to swap it out - we just clear its buffer between tests.
let plugin: PluginTestSurface;

beforeEach(async () => {
  vi.resetModules();
  // Stub env so the reporter's flush path doesn't accidentally network.
  delete process.env.CLAWS_ACTIVITY_ENDPOINT;
  delete process.env.CLAWS_ACTIVITY_SECRET;
  delete process.env.CLAWS_WORKSPACE_ID;
  delete process.env.CLAWS_OVERLAY_SHA;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = (await import("../../container/claws-activity-reporter/index.mjs")) as any;
  plugin = mod.__test__ as PluginTestSurface;
  // Each handler push targets the module-scope `reporter`. Clear its state
  // between tests so the buffer is fresh.
  plugin.reporter.pending.length = 0;
  plugin.reporter.dropped = 0;
});

// ─── Helper: assert sync return ───────────────────────────────────────────
function expectSyncReturn(
  handlerName: string,
  handler: (event: unknown, ctx: unknown) => unknown,
  event: unknown,
  ctx: unknown,
) {
  const ret = handler(event, ctx);
  // A returned Promise (or thenable) means the handler is doing async
  // work inside the hook call path - exactly the failure mode the
  // upstream hook runner would await and that we forbid by design.
  expect(
    ret === undefined,
    `${handlerName} must return undefined (synchronously). Got: ${typeof ret} ${ret instanceof Promise ? "(a Promise - handler is doing async work inside the hook call path; refactor to enqueue then return)" : ""}`,
  ).toBe(true);
  // Belt-and-suspenders: not a thenable.
  expect(
    typeof ret === "object" &&
      ret !== null &&
      typeof (ret as { then?: unknown }).then === "function",
    `${handlerName} returned a thenable; it must return undefined`,
  ).toBe(false);
}

describe("claws-activity-reporter - event mapping", () => {
  describe("before_agent_run → TASK_START", () => {
    it("emits TASK_START with prompt preview", () => {
      plugin.handleBeforeAgentRun(
        { prompt: "Investigate the latest crypto trends", messages: [], channelId: "discord:abc" },
        { agentId: "orchestrator", sessionKey: "agent:main:main", runId: "run-1" },
      );
      const rec = plugin.reporter.pending[0];
      expect(rec.type).toBe("TASK_START");
      expect(rec.agentId).toBe("orchestrator");
      expect(rec.runId).toBe("run-1");
      expect(rec.action).toMatch(/^Task started: Investigate the latest crypto trends/);
      expect(rec.metadata.promptPreview).toBe("Investigate the latest crypto trends");
    });

    it("truncates long prompts in the action preview", () => {
      const longPrompt = "x ".repeat(500); // ~1000 chars
      plugin.handleBeforeAgentRun({ prompt: longPrompt, messages: [] }, { agentId: "orch" });
      const rec = plugin.reporter.pending[0];
      // Default cap is 240 chars in truncate()
      expect((rec.metadata.promptPreview as string).length).toBeLessThanOrEqual(240);
      expect(rec.metadata.promptPreview as string).toMatch(/…$/);
    });

    it("returns synchronously (no Promise)", () => {
      expectSyncReturn(
        "handleBeforeAgentRun",
        plugin.handleBeforeAgentRun,
        { prompt: "x", messages: [] },
        { agentId: "a" },
      );
    });
  });

  describe("agent_end → TASK_COMPLETE / TASK_FAILED", () => {
    it("emits TASK_COMPLETE when event.success === true", () => {
      plugin.handleAgentEnd(
        { success: true, durationMs: 4321, messages: [] },
        { agentId: "orchestrator", runId: "run-2" },
      );
      const rec = plugin.reporter.pending[0];
      expect(rec.type).toBe("TASK_COMPLETE");
      expect(rec.metadata.success).toBe(true);
      expect(rec.metadata.durationMs).toBe(4321);
      expect(rec.action).toMatch(/Task completed/);
    });

    it("emits TASK_FAILED when event.success === false", () => {
      plugin.handleAgentEnd(
        { success: false, error: "Provider returned 5xx after retries", messages: [] },
        { agentId: "orchestrator" },
      );
      const rec = plugin.reporter.pending[0];
      expect(rec.type).toBe("TASK_FAILED");
      expect(rec.metadata.success).toBe(false);
      expect(rec.action).toContain("Provider returned 5xx after retries");
    });

    it("returns synchronously", () => {
      expectSyncReturn(
        "handleAgentEnd",
        plugin.handleAgentEnd,
        { success: true, messages: [] },
        { agentId: "a" },
      );
    });
  });

  describe("message_received → MESSAGE_RECEIVED", () => {
    it("emits MESSAGE_RECEIVED with from + preview", () => {
      plugin.handleMessageReceived(
        { from: "user:1234", content: "hello world", messageId: "m-1" },
        { channelId: "discord:guild-1", sessionKey: "agent:main:main" },
      );
      const rec = plugin.reporter.pending[0];
      expect(rec.type).toBe("MESSAGE_RECEIVED");
      expect(rec.metadata.from).toBe("user:1234");
      expect(rec.metadata.messageId).toBe("m-1");
      expect(rec.action).toContain("hello world");
    });

    it("returns synchronously", () => {
      expectSyncReturn(
        "handleMessageReceived",
        plugin.handleMessageReceived,
        { from: "u", content: "c" },
        { channelId: "x" },
      );
    });
  });

  describe("message_sent → MESSAGE_SENT", () => {
    it("emits MESSAGE_SENT with success=true", () => {
      plugin.handleMessageSent(
        { to: "user:1234", content: "ack", success: true, messageId: "m-out" },
        { channelId: "discord:guild-1" },
      );
      const rec = plugin.reporter.pending[0];
      expect(rec.type).toBe("MESSAGE_SENT");
      expect(rec.metadata.success).toBe(true);
      expect(rec.action).toMatch(/^Sent to user:1234/);
    });

    it("emits MESSAGE_SENT with success=false (error branch)", () => {
      plugin.handleMessageSent(
        {
          to: "user:1234",
          content: "ack",
          success: false,
          error: "Discord 429 rate limit",
        },
        { channelId: "discord:guild-1" },
      );
      const rec = plugin.reporter.pending[0];
      expect(rec.metadata.success).toBe(false);
      expect(rec.action).toContain("failed");
      expect(rec.action).toContain("429");
    });

    it("returns synchronously", () => {
      expectSyncReturn(
        "handleMessageSent",
        plugin.handleMessageSent,
        { to: "u", content: "c", success: true },
        { channelId: "x" },
      );
    });
  });

  describe("after_tool_call → SKILL_INVOKED / ERROR", () => {
    it("emits SKILL_INVOKED on success", () => {
      plugin.handleAfterToolCall(
        { toolName: "web_search", params: { q: "test" }, durationMs: 800, toolCallId: "t-1" },
        { agentId: "trend-scout", sessionKey: "agent:main:trend-scout" },
      );
      const rec = plugin.reporter.pending[0];
      expect(rec.type).toBe("SKILL_INVOKED");
      expect(rec.metadata.toolName).toBe("web_search");
      expect(rec.metadata.durationMs).toBe(800);
    });

    it("emits ERROR when event.error is set", () => {
      plugin.handleAfterToolCall(
        {
          toolName: "twitter_post",
          params: { text: "x" },
          error: "Twitter API returned 403",
        },
        { agentId: "twitter-commander" },
      );
      const rec = plugin.reporter.pending[0];
      expect(rec.type).toBe("ERROR");
      expect(rec.action).toContain("twitter_post failed");
      expect(rec.action).toContain("403");
    });

    it("returns synchronously", () => {
      expectSyncReturn(
        "handleAfterToolCall",
        plugin.handleAfterToolCall,
        { toolName: "x", params: {} },
        { agentId: "a" },
      );
    });
  });

  describe("cron_changed → HEARTBEAT filter", () => {
    it("emits HEARTBEAT only when action='started' AND job name starts with orchestrator-heartbeat-", () => {
      plugin.handleCronChanged(
        {
          action: "started",
          jobId: "job-1",
          job: {
            id: "job-1",
            name: "orchestrator-heartbeat-hourly",
            payload: { kind: "agentTurn", text: "Heartbeat..." },
          },
          agentId: "orchestrator",
        },
        { port: 18789 },
      );
      const rec = plugin.reporter.pending[0];
      expect(rec.type).toBe("HEARTBEAT");
      expect(rec.agentId).toBe("orchestrator");
      expect(rec.metadata.jobId).toBe("job-1");
    });

    it("ignores cron_changed for non-heartbeat jobs (template-defined task)", () => {
      plugin.handleCronChanged(
        {
          action: "started",
          jobId: "job-2",
          job: {
            id: "job-2",
            name: "Daily revenue summary",
            payload: { kind: "agentTurn", text: "Summarize..." },
          },
          agentId: "orchestrator",
        },
        { port: 18789 },
      );
      expect(plugin.reporter.pending.length).toBe(0);
    });

    it("ignores actions other than 'started'", () => {
      for (const action of ["added", "updated", "removed", "finished"]) {
        plugin.handleCronChanged(
          {
            action,
            jobId: "job-1",
            job: { id: "job-1", name: "orchestrator-heartbeat-hourly" },
          },
          { port: 18789 },
        );
      }
      expect(plugin.reporter.pending.length).toBe(0);
    });

    it("isHeartbeatJob helper exposes the deterministic prefix filter", () => {
      // Asserts the cross-reference invariant: the prefix Claws generator
      // writes (src/lib/openclaw/generator.ts:1521) MUST match this
      // constant. If you change one without the other, this test still
      // passes (it tests the constant against itself) but the runtime
      // wiring breaks silently. The grep-anchor in BOTH files is the
      // real defence; this assertion just locks the prefix at the value
      // we authored against.
      expect(plugin.HEARTBEAT_CRON_NAME_PREFIX).toBe("orchestrator-heartbeat-");
      expect(plugin.isHeartbeatJob({ name: "orchestrator-heartbeat-hourly" })).toBe(true);
      expect(plugin.isHeartbeatJob({ name: "orchestrator-heartbeat-every_6h" })).toBe(true);
      expect(plugin.isHeartbeatJob({ name: "Daily revenue summary" })).toBe(false);
      expect(plugin.isHeartbeatJob({ name: "" })).toBe(false);
      expect(plugin.isHeartbeatJob(null)).toBe(false);
      expect(plugin.isHeartbeatJob({})).toBe(false);
    });

    it("returns synchronously", () => {
      expectSyncReturn(
        "handleCronChanged",
        plugin.handleCronChanged,
        {
          action: "started",
          jobId: "j",
          job: { name: "orchestrator-heartbeat-daily" },
        },
        { port: 18789 },
      );
    });
  });
});

// ─── PR-4: short human action + full detail + trigger classification ──────

describe("claws-activity-reporter - PR-4 short action + detail", () => {
  const HEARTBEAT_PROMPT =
    "[cron:heartbeat-dispatch-commander-daily orchestrator-heartbeat-daily] Heartbeat. " +
    "Read HEARTBEAT.md and follow it strictly. If nothing needs attention, reply HEARTBEAT_OK.";

  describe("classifyTrigger", () => {
    it("detects heartbeat via structured ctx.jobId prefix", () => {
      expect(plugin.classifyTrigger({ prompt: "x" }, { jobId: "heartbeat-dispatch-commander-daily" })).toBe("heartbeat");
      expect(plugin.classifyTrigger({ prompt: "x" }, { jobId: "heartbeat-orch-test_5min" })).toBe("heartbeat");
    });

    it("detects heartbeat via the cron trace-prefix fallback when ctx.jobId is absent", () => {
      expect(plugin.classifyTrigger({ prompt: HEARTBEAT_PROMPT }, {})).toBe("heartbeat");
    });

    it("classifies a non-heartbeat cron run as 'cron'", () => {
      expect(plugin.classifyTrigger({ prompt: "[cron:job-7 Daily revenue summary] Summarize..." }, { jobId: "job-7" })).toBe("cron");
      expect(plugin.classifyTrigger({ prompt: "do it" }, { trigger: "cron" })).toBe("cron");
    });

    it("classifies a channel/user prompt as 'task'", () => {
      expect(plugin.classifyTrigger({ prompt: "Investigate the latest crypto trends" }, { channelId: "discord:abc" })).toBe("task");
    });

    it("HEARTBEAT_CRON_ID_PREFIX is the generator's cron id prefix", () => {
      expect(plugin.HEARTBEAT_CRON_ID_PREFIX).toBe("heartbeat-");
    });
  });

  it("heartbeat-triggered TASK_START → action 'Heartbeat check', raw prompt in detail", () => {
    plugin.handleBeforeAgentRun(
      { prompt: HEARTBEAT_PROMPT, messages: [] },
      { agentId: "dispatch-commander", jobId: "heartbeat-dispatch-commander-daily", trigger: "cron" },
    );
    const rec = plugin.reporter.pending[0];
    expect(rec.type).toBe("TASK_START");
    expect(rec.action).toBe("Heartbeat check");
    expect(rec.metadata.triggerKind).toBe("heartbeat");
    // The raw plumbing prompt is preserved in detail for expand-on-click.
    expect(rec.detail).toContain("HEARTBEAT.md");
    expect(rec.detail).toContain("[cron:");
  });

  it("MUTATION-anchored: heartbeat action must NOT leak the raw prompt plumbing", () => {
    plugin.handleBeforeAgentRun(
      { prompt: HEARTBEAT_PROMPT, messages: [] },
      { agentId: "dispatch-commander", jobId: "heartbeat-dispatch-commander-daily" },
    );
    const rec = plugin.reporter.pending[0];
    // If the shortening is reverted (action = `Task started: ${promptPreview}`),
    // the action would contain the [cron:...] prefix and/or "HEARTBEAT.md" -
    // exactly the engineer-output the dashboard must not show. This is the
    // mutation guard for the action-shortening behavior.
    expect(rec.action).not.toContain("[cron:");
    expect(rec.action).not.toContain("HEARTBEAT.md");
    expect(rec.action).not.toContain("HEARTBEAT_OK");
    expect(rec.action.length).toBeLessThanOrEqual(40);
  });

  it("cron-triggered (non-heartbeat) TASK_START → 'Scheduled task started'", () => {
    plugin.handleBeforeAgentRun(
      { prompt: "[cron:job-7 Daily revenue summary] Summarize today's revenue", messages: [] },
      { agentId: "orchestrator", jobId: "job-7", trigger: "cron" },
    );
    const rec = plugin.reporter.pending[0];
    expect(rec.action).toBe("Scheduled task started");
    expect(rec.metadata.triggerKind).toBe("cron");
    expect(rec.detail).toContain("Daily revenue summary");
  });

  it("normal task TASK_START → short preview in action, full prompt in detail", () => {
    const longPrompt = "Investigate the latest crypto trends and " + "x".repeat(300);
    plugin.handleBeforeAgentRun({ prompt: longPrompt, messages: [] }, { agentId: "orch", channelId: "discord:1" });
    const rec = plugin.reporter.pending[0];
    expect(rec.metadata.triggerKind).toBe("task");
    expect(rec.action.startsWith("Task started: ")).toBe(true);
    // action preview capped at ACTION_PREVIEW_MAX (100) → "Task started: " + ≤100.
    expect(rec.action.length).toBeLessThanOrEqual("Task started: ".length + plugin.ACTION_PREVIEW_MAX);
    // full prompt preserved in detail (longer than the action preview).
    expect((rec.detail as string).length).toBeGreaterThan(rec.action.length);
  });

  it("agent_end failure puts the full error in detail, short error in action", () => {
    const longErr = "Provider 500: " + "stacktrace ".repeat(60);
    plugin.handleAgentEnd({ success: false, error: longErr, messages: [] }, { agentId: "orch" });
    const rec = plugin.reporter.pending[0];
    expect(rec.type).toBe("TASK_FAILED");
    expect(rec.action.startsWith("Task failed: ")).toBe(true);
    expect(rec.action.length).toBeLessThanOrEqual("Task failed: ".length + plugin.ACTION_PREVIEW_MAX);
    expect((rec.detail as string).length).toBeGreaterThan(rec.action.length);
  });

  it("after_tool_call error puts the full error in detail", () => {
    const longErr = "Twitter API 403: " + "y".repeat(300);
    plugin.handleAfterToolCall({ toolName: "twitter_post", error: longErr }, { agentId: "tw" });
    const rec = plugin.reporter.pending[0];
    expect(rec.type).toBe("ERROR");
    expect(rec.action.startsWith("Tool twitter_post failed")).toBe(true);
    expect((rec.detail as string).length).toBeGreaterThan(rec.action.length);
  });

  it("clip() preserves newlines (no whitespace collapse) and caps length", () => {
    expect(plugin.clip("a\n\nb")).toBe("a\n\nb");
    expect(plugin.clip("")).toBeUndefined();
    expect(plugin.clip(123 as unknown)).toBeUndefined();
    const capped = plugin.clip("z".repeat(5000));
    expect((capped as string).length).toBe(plugin.DETAIL_MAX);
    expect((capped as string).endsWith("…")).toBe(true);
  });
});

describe("claws-activity-reporter - UsageReporter buffer", () => {
  let r: InstanceType<PluginTestSurface["ActivityReporter"]>;

  beforeEach(async () => {
    delete process.env.CLAWS_ACTIVITY_ENDPOINT; // disable network in tests
    vi.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = (await import("../../container/claws-activity-reporter/index.mjs")) as any;
    r = new mod.__test__.ActivityReporter();
  });

  it("add(record) is synchronous (returns undefined, no Promise)", () => {
    const ret = r.add({
      type: "TASK_START",
      agentId: null,
      runId: null,
      action: "x",
      metadata: {},
    });
    expect(ret).toBeUndefined();
    expect(r.pending.length).toBe(1);
  });

  it("drops oldest on overflow above 500 records, increments dropped counter", () => {
    // Stub the opportunistic auto-flush. add() fires `void this.flush()`
    // whenever pending >= BATCH_SIZE (50), and flush()'s early-return
    // path (when ENDPOINT_BASE is unset) synchronously clears `pending`.
    // To exercise the OVERFLOW branch in isolation we silence the flusher.
    // The real overflow scenario in production happens between flush
    // attempts (e.g., network is failing so flush keeps re-queueing at
    // the front, and adds outpace drains).
    r.flush = async () => {};
    for (let i = 0; i < 600; i++) {
      r.add({
        type: "TASK_START",
        agentId: null,
        runId: null,
        action: `e-${i}`,
        metadata: {},
      });
    }
    expect(r.pending.length).toBe(500);
    expect(r.dropped).toBe(100);
    // The oldest 100 were dropped; the surviving 500 are records 100..599.
    expect(r.pending[0].action).toBe("e-100");
    expect(r.pending[r.pending.length - 1].action).toBe("e-599");
  });

  it("flush() is a no-op when ENDPOINT_BASE is unset (drops buffer)", async () => {
    delete process.env.CLAWS_ACTIVITY_ENDPOINT;
    r.add({
      type: "TASK_START",
      agentId: null,
      runId: null,
      action: "x",
      metadata: {},
    });
    expect(r.pending.length).toBe(1);
    await r.flush();
    expect(r.pending.length).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// PR-9/A-container - webchat reply-row emission (contract C1–C6)
//
// agent_end for a webchat turn must emit exactly ONE additional MESSAGE_SENT
// row carrying the assistant reply + turn health, AFTER the unchanged
// TASK_COMPLETE/TASK_FAILED record. Non-webchat turns (cron, heartbeat,
// worker spawns, channel-less) emit ZERO reply rows. Mutation-verified:
//   - detection trigger legs dropped  → C5 cron/heartbeat negatives fail
//   - detection subagent leg dropped  → C5 subagent negative fails
//   - truncation removed              → C3 boundary test fails
//   - turnHealth from event.success   → C2 divergence test fails
// ════════════════════════════════════════════════════════════════════════════
describe("claws-activity-reporter - PR-9/A webchat reply rows", () => {
  // Cast once: isWebchatReplyTurn/extractAssistantReply/clipWithFlag are new
  // __test__ exports not in the PluginTestSurface interface above (kept
  // narrow deliberately - the older blocks don't need them).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ext = () => plugin as any;

  const WEBCHAT_CTX = {
    agentId: "dev-commander",
    runId: "idem-key-1",
    sessionKey: "agent:dev-commander:main",
    channelId: "webchat",
  };

  function assistantMessages(text: string, extra: Record<string, unknown> = {}) {
    return [
      { role: "user", content: [{ type: "text", text: "hi" }] },
      {
        role: "assistant",
        content: [{ type: "text", text }],
        stopReason: "stop",
        usage: { input: 10, output: 478, totalTokens: 19319, cost: { total: 0.0259 } },
        ...extra,
      },
    ];
  }

  it("C1+C6: webchat agent_end emits exactly [TASK_COMPLETE, MESSAGE_SENT] in order, TASK_COMPLETE byte-identical", () => {
    // Pre-extension TASK_COMPLETE capture (from the pre-PR-9/A handler):
    // the first emitted record must still match this shape EXACTLY.
    plugin.handleAgentEnd(
      { success: true, durationMs: 6047, messages: assistantMessages("Here are three checks…") },
      WEBCHAT_CTX,
    );
    expect(plugin.reporter.pending).toHaveLength(2);

    const [task, reply] = plugin.reporter.pending;
    expect(task.type).toBe("TASK_COMPLETE");
    expect(task.agentId).toBe("dev-commander");
    expect(task.runId).toBe("idem-key-1");
    expect(task.action).toBe("Task completed in 6s");
    expect(task.detail).toBeUndefined();
    expect(task.metadata).toEqual({ success: true, durationMs: 6047, error: undefined });

    expect(reply.type).toBe("MESSAGE_SENT");
    expect(reply.runId).toBe("idem-key-1");
    expect(reply.action).toBe("Replied: Here are three checks…");
    expect(reply.detail).toBe("Here are three checks…");
  });

  it("C2: reply metadata carries to/stopReason/turnHealth/truncated/usage (usage trimmed to 4 keys)", () => {
    plugin.handleAgentEnd(
      { success: true, messages: assistantMessages("Short reply") },
      WEBCHAT_CTX,
    );
    const reply = plugin.reporter.pending[1];
    expect(reply.metadata.to).toBe("webchat");
    expect(reply.metadata.stopReason).toBe("stop");
    expect(reply.metadata.turnHealth).toBe("ok");
    expect(reply.metadata.truncated).toBe(false);
    expect(reply.metadata.usage).toEqual({
      input: 10,
      output: 478,
      totalTokens: 19319,
      costTotal: 0.0259,
    });
    // channelId/sessionKey live as TOP-LEVEL record fields (the ingest route
    // merges them into stored metadata server-side - contract v0.2).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((reply as any).channelId).toBe("webchat");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((reply as any).sessionKey).toBe("agent:dev-commander:main");
  });

  it("C2 divergence: event.success=true with stopReason 'error' → turnHealth 'error' (NEVER from success)", () => {
    // Captured live in the PR-9/0 spike: an errored LLM turn still produced
    // agent_end success:true. turnHealth must come from the transcript.
    plugin.handleAgentEnd(
      {
        success: true, // the lie
        messages: assistantMessages("[assistant turn failed before producing content]", {
          stopReason: "error",
          errorMessage: '{"type":"error","error":{"type":"authentication_error"}}',
        }),
      },
      WEBCHAT_CTX,
    );
    const reply = plugin.reporter.pending[1];
    expect(reply.type).toBe("MESSAGE_SENT");
    expect(reply.metadata.turnHealth).toBe("error");
    expect(reply.action).toMatch(/^Reply failed/);
  });

  it("C3 boundary: 4001-char reply → 4000 chars + truncated:true; 4000-char → untruncated, truncated:false", () => {
    plugin.handleAgentEnd(
      { success: true, messages: assistantMessages("y".repeat(4001)) },
      WEBCHAT_CTX,
    );
    const long = plugin.reporter.pending[1];
    expect((long.detail as string).length).toBe(4000); // 3999 chars + "…"
    expect((long.detail as string).endsWith("…")).toBe(true);
    expect(long.metadata.truncated).toBe(true);

    plugin.reporter.pending.length = 0;
    plugin.handleAgentEnd(
      { success: true, messages: assistantMessages("y".repeat(4000)) },
      WEBCHAT_CTX,
    );
    const exact = plugin.reporter.pending[1];
    expect((exact.detail as string).length).toBe(4000);
    expect((exact.detail as string).endsWith("…")).toBe(false);
    expect(exact.metadata.truncated).toBe(false);
  });

  it("C4: errored turn still emits the reply row - turnHealth 'error', error text in detail", () => {
    plugin.handleAgentEnd(
      {
        success: false,
        error: "LLM error authentication_error: invalid x-api-key",
        messages: assistantMessages("[assistant turn failed before producing content]", {
          stopReason: "error",
          errorMessage: "authentication_error: invalid x-api-key",
        }),
      },
      WEBCHAT_CTX,
    );
    // TASK_FAILED first (existing behavior), then the reply row.
    expect(plugin.reporter.pending[0].type).toBe("TASK_FAILED");
    const reply = plugin.reporter.pending[1];
    expect(reply.type).toBe("MESSAGE_SENT");
    expect(reply.metadata.turnHealth).toBe("error");
    expect(reply.detail).toContain("failed before producing content");
  });

  it("C5 negatives: cron / heartbeat / subagent / channel-less turns emit ZERO reply rows", () => {
    const event = { success: true, messages: assistantMessages("should not be emitted") };
    const cases = [
      { ...WEBCHAT_CTX, trigger: "cron" },
      { ...WEBCHAT_CTX, trigger: "heartbeat" },
      { ...WEBCHAT_CTX, sessionKey: "agent:dev-commander:subagent:pr-reviewer:abc123" },
      { ...WEBCHAT_CTX, channelId: undefined },
    ];
    for (const ctx of cases) {
      plugin.reporter.pending.length = 0;
      plugin.handleAgentEnd(event, ctx);
      const types = plugin.reporter.pending.map((p) => p.type);
      expect(types, `ctx=${JSON.stringify(ctx)}`).toEqual(["TASK_COMPLETE"]);
    }
  });

  it("no-assistant-item fallback: emits with event.error (or placeholder) and turnHealth 'error'", () => {
    plugin.handleAgentEnd(
      { success: false, error: "crashed before any message persisted", messages: [] },
      WEBCHAT_CTX,
    );
    const reply = plugin.reporter.pending[1];
    expect(reply.type).toBe("MESSAGE_SENT");
    expect(reply.metadata.turnHealth).toBe("error");
    expect(reply.detail).toBe("crashed before any message persisted");

    plugin.reporter.pending.length = 0;
    plugin.handleAgentEnd({ success: true, messages: [] }, WEBCHAT_CTX);
    const placeholder = plugin.reporter.pending[1];
    expect(placeholder.metadata.turnHealth).toBe("error");
    expect(placeholder.detail).toBe("(no reply produced)");
  });

  it("multi-block content: concatenates only type==='text' blocks in array order", () => {
    plugin.handleAgentEnd(
      {
        success: true,
        messages: [
          { role: "user", content: [{ type: "text", text: "q" }] },
          {
            role: "assistant",
            content: [
              { type: "text", text: "Part one." },
              { type: "tool_use", name: "search", input: {} },
              { type: "text", text: "Part two." },
            ],
            stopReason: "stop",
          },
        ],
      },
      WEBCHAT_CTX,
    );
    expect(plugin.reporter.pending[1].detail).toBe("Part one.\nPart two.");
  });

  it("extraction picks the LAST assistant item (tool-use turns interleave items)", () => {
    plugin.handleAgentEnd(
      {
        success: true,
        messages: [
          { role: "user", content: [{ type: "text", text: "q" }] },
          { role: "assistant", content: [{ type: "text", text: "thinking…" }], stopReason: "tool_use" },
          { role: "tool", content: [{ type: "text", text: "result" }] },
          { role: "assistant", content: [{ type: "text", text: "Final answer." }], stopReason: "stop" },
        ],
      },
      WEBCHAT_CTX,
    );
    expect(plugin.reporter.pending[1].detail).toBe("Final answer.");
    expect(plugin.reporter.pending[1].metadata.stopReason).toBe("stop");
  });

  it("handleAgentEnd still returns synchronously with the reply-row path active", () => {
    expectSyncReturn(
      "handleAgentEnd",
      plugin.handleAgentEnd,
      { success: true, messages: assistantMessages("x") },
      WEBCHAT_CTX,
    );
  });

  it("clipWithFlag matches clip() semantics and clip() itself is untouched", () => {
    expect(ext().clipWithFlag("  hello  ")).toEqual({ text: "hello", truncated: false });
    expect(ext().clipWithFlag("")).toEqual({ text: undefined, truncated: false });
    expect(ext().clipWithFlag(undefined)).toEqual({ text: undefined, truncated: false });
    const cut = ext().clipWithFlag("z".repeat(5000));
    expect(cut.text.length).toBe(4000);
    expect(cut.truncated).toBe(true);
    // clip() unchanged: same output text for the same input.
    expect(plugin.clip("z".repeat(5000))).toBe(cut.text);
  });
});

describe("claws-activity-reporter - overlay boot emission-version (PR-2 -8)", () => {
  it("boot event carries metadata.clawsOverlaySha from CLAWS_OVERLAY_SHA", async () => {
    vi.resetModules();
    process.env.CLAWS_OVERLAY_SHA = "abc123overlaysha";
    delete process.env.CLAWS_ACTIVITY_ENDPOINT;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mod = (await import("../../container/claws-activity-reporter/index.mjs")) as any;
    mod.__test__.reporter.pending.length = 0;
    mod.__test__.emitOverlayBootEvent();
    const rec = mod.__test__.reporter.pending[0];
    expect(rec.type).toBe("TASK_START");
    expect(rec.action).toBe("Claws overlay boot");
    expect(rec.metadata.eventKind).toBe("overlay_boot");
    expect(rec.metadata.clawsOverlaySha).toBe("abc123overlaysha");
    // Mutation: dropping clawsOverlaySha from the boot payload fails.
    expect(rec.metadata).toHaveProperty("clawsOverlaySha");
  });
});
