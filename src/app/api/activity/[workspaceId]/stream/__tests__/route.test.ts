// @vitest-environment node
//
// PR-4d: SSE stream serializer + structural completeness tests.
//
// The bug this guards against: PR-4 added `detail` to ActivityLog and the
// regular GET endpoint serialized it, but the SSE stream's formatLog() was
// not updated. The dashboard's live activity feed reads from the SSE
// stream - so the component never received a populated `detail` prop and
// the click-to-expand affordance never lit up in production.
//
// The structural test below is the load-bearing protection: it asserts
// formatLog's output keys EXACTLY equal (ActivityLog scalar fields −
// SSE_EXCLUDED_FIELDS). Adding a new column to the schema without
// updating either the serializer or the exclusion list MUST fail.
// Same defense pattern as PR-2d's BOM-guard and PR-4c's clone-reference
// guard - invariants over per-symptom tests.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { readFileSync } from "fs"
import { join } from "path"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { createMockRequest } from "@/test/helpers/mock-request"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))
vi.mock("@/lib/api/auth", () => ({
  getSessionUser: vi.fn(async () => ({ id: "user-1" })),
}))
vi.mock("@/lib/api/ownership", () => ({
  verifyWorkspaceOwnership: vi.fn(async () => ({ error: null, workspace: { id: "ws-1" } })),
}))
vi.mock("@/lib/security/sanitize", () => ({
  sanitizeActivityText: vi.fn((s: string) => s),
  // Passthrough that mirrors the real null-for-empty contract. The real
  // HTML-strip + cap is unit-tested in lib/security/__tests__/sanitize.test.ts.
  sanitizeActivityDetail: vi.fn((s: string | null | undefined) =>
    s && s.length > 0 ? s : null
  ),
}))

import { GET, formatLog, maxDuration } from "@/app/api/activity/[workspaceId]/stream/route"
import { chatRunStateInitWhere, CHAT_RUN_STATE_STREAM_SCOPE } from "@/lib/chat/run-state"

const WORKSPACE_ID = "ws-1"

const baseRow = {
  id: "log-1",
  workspaceId: WORKSPACE_ID,
  timestamp: new Date("2026-05-31T14:10:00.004Z"),
  agentName: "Orchestrator",
  agentSlug: "dispatch-commander",
  action: "Heartbeat check",
  actionType: "TASK_START",
  detail: "[cron:heartbeat-x] full prompt with the cron trace prefix",
  metadata: '{"triggerKind":"heartbeat"}',
  channelId: null,
  tokenCount: 1234,
  apiCost: 0.0021,
} as const

// Fields the SSE stream intentionally does NOT serialize. Each must be
// justified - adding to this list is a deliberate decision, not a quiet
// omission. If you remove a field from this list it MUST appear in
// formatLog's output and vice versa; the structural test enforces that.
const SSE_EXCLUDED_FIELDS: ReadonlyArray<string> = [
  // implicit in the SSE URL (/api/activity/[workspaceId]/stream); repeating
  // per-row would waste bytes on every event payload.
  "workspaceId",
  // structured JSON payload; the RAW blob is not consumed by the UI and can
  // contain large arrays. Stays off the wire - but PR-9/B projects a small
  // whitelist out of it (see SSE_DERIVED_FIELDS) for the chat panel.
  "metadata",
  // per-row token counts are not surfaced in the live feed; aggregate
  // costs are exposed via the regular /api/activity/[workspaceId] GET
  // (cost-breakdown-table). No consumer would render this on the live feed.
  "tokenCount",
]

// PR-9/B: fields formatLog DERIVES from `metadata` rather than serializing a
// 1:1 schema column. `metadata` itself stays in SSE_EXCLUDED_FIELDS (the raw
// blob is off the wire); these are the explicit projections the dashboard chat
// panel needs (messageId = reconciliation key;
// from = sender hint; runId = turn-correlation key for the working indicator).
// K2 promoted channelId to a scalar column, so it is now covered by the schema
// field list rather than this derived-field list.
// Enumerated here so the structural assertion stays exact:
//   formatLog output === (scalar fields − SSE_EXCLUDED_FIELDS) + SSE_DERIVED_FIELDS.
// Adding a projection without listing it here (or vice versa) MUST fail (d).
const SSE_DERIVED_FIELDS: ReadonlyArray<string> = [
  "messageId",
  "from",
  "runId",
  "eventKind",
  "fileVersionId",
  "logicalPath",
  "preview",
  "deliverableKind",
  "humanRequestId",
  "holdStatus",
  "toolId",
  "sessionKey",
]

function getActivityLogScalarFields(): string[] {
  const schemaPath = join(process.cwd(), "prisma/schema.prisma")
  const schema = readFileSync(schemaPath, "utf8")
  const match = schema.match(/model ActivityLog \{([\s\S]*?)\n\}/)
  if (!match) {
    throw new Error("ActivityLog model not found in prisma/schema.prisma")
  }
  const body = match[1]
  const fields: string[] = []
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim()
    if (!line) continue
    if (line.startsWith("//")) continue
    if (line.startsWith("@@")) continue
    if (line.includes("@relation")) continue
    const fieldMatch = line.match(/^(\w+)\s+/)
    if (fieldMatch) fields.push(fieldMatch[1])
  }
  return fields
}

describe("SSE /api/activity/[workspaceId]/stream - formatLog", () => {
  it("(c) serializes detail when populated", () => {
    const out = formatLog(baseRow)
    expect(out).toMatchObject({
      detail: "[cron:heartbeat-x] full prompt with the cron trace prefix",
    })
  })

  it("(c) wires detail through sanitizeActivityDetail - null when absent", () => {
    const out = formatLog({ ...baseRow, detail: null })
    expect(out.detail).toBeNull()
  })

  it("(d) STRUCTURAL: formatLog output keys equal (ActivityLog scalar fields − SSE_EXCLUDED_FIELDS) + SSE_DERIVED_FIELDS", () => {
    const schemaFields = getActivityLogScalarFields()
    const expectedOutputFields = [
      ...schemaFields.filter((f) => !SSE_EXCLUDED_FIELDS.includes(f)),
      ...SSE_DERIVED_FIELDS,
    ].sort()
    const actualOutputFields = Object.keys(formatLog(baseRow)).sort()
    expect(actualOutputFields).toEqual(expectedOutputFields)
  })

  it("(d-meta) deliberate-failure: if a column lands in schema but neither the formatter nor the exclusion list mentions it, the structural assertion diverges", () => {
    const realSchemaFields = getActivityLogScalarFields()
    const augmentedSchemaFields = [...realSchemaFields, "__hypothetical_new_column__"]
    const expectedOutputFields = [
      ...augmentedSchemaFields.filter((f) => !SSE_EXCLUDED_FIELDS.includes(f)),
      ...SSE_DERIVED_FIELDS,
    ].sort()
    const actualOutputFields = Object.keys(formatLog(baseRow)).sort()
    expect(actualOutputFields).not.toEqual(expectedOutputFields)
  })

  it("(d-meta) deliberate-failure: if formatLog drops a serialized field, the structural assertion diverges", () => {
    const schemaFields = getActivityLogScalarFields()
    const expectedOutputFields = [
      ...schemaFields.filter((f) => !SSE_EXCLUDED_FIELDS.includes(f)),
      ...SSE_DERIVED_FIELDS,
    ].sort()
    const regressedOutput = Object.keys(formatLog(baseRow))
      .filter((k) => k !== "detail")
      .sort()
    expect(regressedOutput).not.toEqual(expectedOutputFields)
  })

  // PR-9/B: the reconciliation key + webchat filter must reach the wire.
  // A user send is persisted as MESSAGE_RECEIVED: the key is in metadata.messageId
  // (runId is null until the orchestrator starts the turn - protocol §A.3).
  it("(PR-9/B) projects messageId/channelId/from out of metadata for the chat panel", () => {
    const out = formatLog({
      ...baseRow,
      actionType: "MESSAGE_RECEIVED",
      metadata: JSON.stringify({
        from: "",
        messageId: "7ba631e0-033a-46f9-ade7-839345efe8ce",
        channelId: "webchat",
        senderId: "gateway-client",
        runId: null,
      }),
    })
    expect(out.messageId).toBe("7ba631e0-033a-46f9-ade7-839345efe8ce")
    expect(out.channelId).toBe("webchat")
    expect(out.from).toBe("")
    expect(out.runId).toBeNull()
  })

  // WORKING-INDICATOR FIX: the agent reply (MESSAGE_SENT) carries the turn key in
  // metadata.runId === the original send's runId. Projecting it lets the panel
  // pair a reply to its send per-turn. MUTATION: drop `runId` from formatLog's
  // output → out.runId is undefined → this fails (and so does the structural (d)).
  it("(working-indicator) projects runId out of metadata for the agent reply (MESSAGE_SENT)", () => {
    const out = formatLog({
      ...baseRow,
      actionType: "MESSAGE_SENT",
      metadata: JSON.stringify({
        to: "webchat",
        channelId: "webchat",
        runId: "093bd07b-fae0-4c11-9a2a-7b6f0c0d1e2f",
      }),
    })
    expect(out.runId).toBe("093bd07b-fae0-4c11-9a2a-7b6f0c0d1e2f")
    expect(out.channelId).toBe("webchat")
  })

  it("(PR-9/B) derived chat fields are null when metadata is absent or malformed (never throws)", () => {
    expect(formatLog({ ...baseRow, metadata: null }).messageId).toBeNull()
    expect(formatLog({ ...baseRow, metadata: null }).runId).toBeNull()
    const malformed = formatLog({ ...baseRow, metadata: "}{ not json" })
    expect(malformed.messageId).toBeNull()
    expect(malformed.channelId).toBeNull()
    expect(malformed.from).toBeNull()
    expect(malformed.runId).toBeNull()
  })
})

// ─── Integration tests against the GET handler's SSE stream ───────────────
//
// Spin up GET, consume the ReadableStream, parse SSE events, assert that
// `detail` flows through both:
//   (a) the init event (synchronous initial 50-log dump on connect)
//   (b) the log event (polling loop, fires every 2s)

async function readNextNonHeartbeatEvent(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  buffer: { value: string },
  maxWaitMs = 5000,
): Promise<{ event: string; data: unknown }> {
  const deadline = Date.now() + maxWaitMs
  while (Date.now() < deadline) {
    const sep = buffer.value.indexOf("\n\n")
    if (sep >= 0) {
      const raw = buffer.value.slice(0, sep)
      buffer.value = buffer.value.slice(sep + 2)
      const eventLine = raw.split("\n").find((l) => l.startsWith("event: "))
      const dataLine = raw.split("\n").find((l) => l.startsWith("data: "))
      if (!eventLine || !dataLine) continue
      const event = eventLine.slice("event: ".length)
      const data = JSON.parse(dataLine.slice("data: ".length))
      if (event === "heartbeat") continue
      return { event, data }
    }
    const { value, done } = await reader.read()
    if (done) throw new Error("stream ended without a non-heartbeat event")
    buffer.value += decoder.decode(value)
  }
  throw new Error(`timed out after ${maxWaitMs}ms waiting for a non-heartbeat event`)
}

describe("SSE /api/activity/[workspaceId]/stream - events", () => {
  let abortController: AbortController

  beforeEach(() => {
    abortController = new AbortController()
    vi.clearAllMocks()
  })
  afterEach(() => {
    abortController.abort()
  })

  it("(a) init event payload includes detail per row", async () => {
    ;(prismaMock.activityLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { ...baseRow },
    ] as never)

    const req = createMockRequest(`/api/activity/${WORKSPACE_ID}/stream`)
    Object.defineProperty(req, "signal", { get: () => abortController.signal })

    const response = await GET(req, {
      params: Promise.resolve({ workspaceId: WORKSPACE_ID }),
    })
    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toBe("text/event-stream")

    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    const buffer = { value: "" }
    const initEvent = await readNextNonHeartbeatEvent(reader, decoder, buffer)
    expect(initEvent.event).toBe("init")
    const initData = initEvent.data as Array<{ id: string; detail: string | null }>
    expect(initData).toHaveLength(1)
    expect(initData[0].id).toBe("log-1")
    expect(initData[0].detail).toBe(
      "[cron:heartbeat-x] full prompt with the cron trace prefix",
    )
  })

  it("(b) log event payload includes detail per row (polling tick after init)", async () => {
    // First call (initialLogs): empty → init event payload is []
    // Second call (polling tick): one new row → log event payload includes detail
    ;(prismaMock.activityLog.findMany as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([{ ...baseRow }] as never)

    const req = createMockRequest(`/api/activity/${WORKSPACE_ID}/stream`)
    Object.defineProperty(req, "signal", { get: () => abortController.signal })

    const response = await GET(req, {
      params: Promise.resolve({ workspaceId: WORKSPACE_ID }),
    })

    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    const buffer = { value: "" }

    // Consume init event (empty payload).
    const initEvent = await readNextNonHeartbeatEvent(reader, decoder, buffer)
    expect(initEvent.event).toBe("init")
    expect(initEvent.data).toEqual([])

    // Wait for the polling tick (2s) to fire and emit a log event.
    // Real timers; up to 5s budget covers the 2s interval + jitter.
    const logEvent = await readNextNonHeartbeatEvent(reader, decoder, buffer)
    expect(logEvent.event).toBe("log")
    const logData = logEvent.data as { id: string; detail: string | null }
    expect(logData.id).toBe("log-1")
    expect(logData.detail).toBe(
      "[cron:heartbeat-x] full prompt with the cron trace prefix",
    )
  }, 10_000)

  it("MUTATION: maxDuration is 300 so Vercel keeps SSE up for a long turn", () => {
    expect(maxDuration).toBe(300)
    const src = readFileSync(join(process.cwd(), "src/app/api/activity/[workspaceId]/stream/route.ts"), "utf8")
    expect(src).toMatch(/export const maxDuration = 300/)
  })

  it("chat-run-state scope inits from chat-relevant rows, not mixed last-50", async () => {
    ;(prismaMock.activityLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValueOnce([] as never)

    const req = createMockRequest(
      `/api/activity/${WORKSPACE_ID}/stream?scope=${CHAT_RUN_STATE_STREAM_SCOPE}`,
    )
    Object.defineProperty(req, "signal", { get: () => abortController.signal })

    const response = await GET(req, {
      params: Promise.resolve({ workspaceId: WORKSPACE_ID }),
    })
    expect(response.status).toBe(200)
    expect(prismaMock.activityLog.findMany).toHaveBeenCalledWith({
      where: chatRunStateInitWhere(WORKSPACE_ID),
      orderBy: { timestamp: "desc" },
      take: 50,
    })
  })
})
