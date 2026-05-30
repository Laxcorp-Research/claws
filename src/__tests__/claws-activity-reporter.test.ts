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
//   1. EVENT MAPPING — each of the 6 hook handlers produces the right
//      ActivityType + action shape from a representative hook payload.
//      Payload shapes verified against upstream OpenClaw v2026.5.22 source
//      (tmp/openclaw-src/src/plugins/hook-types.ts and hook-message.types.ts).
//
//   2. SYNC HANDLER INVARIANT — every handler must return SYNCHRONOUSLY
//      (not a Promise). The upstream void-hook runner wraps returns in
//      Promise.resolve() and awaits all of them under per-hook timeouts —
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
// We don't try to swap it out — we just clear its buffer between tests.
let plugin: PluginTestSurface;

beforeEach(async () => {
  vi.resetModules();
  // Stub env so the reporter's flush path doesn't accidentally network.
  delete process.env.CLAWS_ACTIVITY_ENDPOINT;
  delete process.env.CLAWS_ACTIVITY_SECRET;
  delete process.env.CLAWS_WORKSPACE_ID;
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
  // work inside the hook call path — exactly the failure mode the
  // upstream hook runner would await and that we forbid by design.
  expect(
    ret === undefined,
    `${handlerName} must return undefined (synchronously). Got: ${typeof ret} ${ret instanceof Promise ? "(a Promise — handler is doing async work inside the hook call path; refactor to enqueue then return)" : ""}`,
  ).toBe(true);
  // Belt-and-suspenders: not a thenable.
  expect(
    typeof ret === "object" &&
      ret !== null &&
      typeof (ret as { then?: unknown }).then === "function",
    `${handlerName} returned a thenable; it must return undefined`,
  ).toBe(false);
}

describe("claws-activity-reporter — event mapping", () => {
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

describe("claws-activity-reporter — PR-4 short action + detail", () => {
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
    // the action would contain the [cron:...] prefix and/or "HEARTBEAT.md" —
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

describe("claws-activity-reporter — UsageReporter buffer", () => {
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
