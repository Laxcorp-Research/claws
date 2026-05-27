// PR-2: Activity Wire bridge — receives batched events from the in-container
// `claws-activity-reporter` OpenClaw plugin and writes them to `ActivityLog`.
//
// Path: POST /api/internal/activity/[workspaceId]
// Auth: X-Activity-Secret header against process.env.ACTIVITY_PIPELINE_SECRET.
//
// This route exists ONLY for events sourced from inside container processes.
// User-action ActivityLog rows continue to be written directly by their own
// routes (agents/.../control writes SYSTEM, workspaces/.../respond writes
// HUMAN_APPROVE / HUMAN_REJECT). We deliberately reject those `actionType`
// values here so a compromised container secret can't forge them.
//
// Allowed actionType subset (8 of 21 — see ALLOWED_ACTION_TYPES below).
// Out-of-scope this PR: writing `apiCost`. The endpoint accepts no `apiCost`
// field; all rows have `apiCost: null`. PR-2b will wire cost separately.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { apiSuccess, apiError } from "@/lib/api/response";
import { log } from "@/lib/logger";
import type { ActivityType } from "@/generated/prisma/client";

// ─── Event-type allowlist ─────────────────────────────────────────────────
//
// The container plugin is allowed to emit these 8. Other ActivityType values
// are intentionally NOT here:
//   - SYSTEM            → emitted by agents/[workspaceId]/[id]/control/route.ts
//   - HUMAN_APPROVE     → emitted by workspaces/[id]/respond/route.ts
//   - HUMAN_REJECT      → emitted by workspaces/[id]/respond/route.ts
//   - HUMAN_REQUEST     → no source today (Claws-template concept, PR-3+ scope)
//   - REVIEW_PASS / REVIEW_REJECT → Claws-template concept
//   - COST_ALERT        → computed Claws-side; PR-2b scope
//   - TRADE_*           → trading-template specific
//   - CIRCUIT_BREAKER   → trading-template specific
//
// If a container forges any of those, the endpoint rejects with 400 so the
// activity wire stays an honest source for the 8 it owns.
const ALLOWED_ACTION_TYPES = new Set<ActivityType>([
  "TASK_START",
  "TASK_COMPLETE",
  "TASK_FAILED",
  "MESSAGE_RECEIVED",
  "MESSAGE_SENT",
  "SKILL_INVOKED",
  "HEARTBEAT",
  "ERROR",
]);

const MAX_BATCH = 50;

interface IncomingEvent {
  type?: unknown;
  timestamp?: unknown;
  agentId?: unknown;
  runId?: unknown;
  sessionKey?: unknown;
  channelId?: unknown;
  action?: unknown;
  metadata?: unknown;
}

interface ValidatedEvent {
  type: ActivityType;
  timestamp: Date;
  agentId: string | null;
  runId: string | null;
  sessionKey: string | null;
  channelId: string | null;
  action: string;
  metadata: Record<string, unknown>;
}

function isAllowedActionType(value: unknown): value is ActivityType {
  return typeof value === "string" && ALLOWED_ACTION_TYPES.has(value as ActivityType);
}

function validateEvent(raw: IncomingEvent, index: number):
  | { ok: true; event: ValidatedEvent }
  | { ok: false; message: string } {
  if (!raw || typeof raw !== "object") {
    return { ok: false, message: `events[${index}] is not an object` };
  }
  if (!isAllowedActionType(raw.type)) {
    return {
      ok: false,
      message: `events[${index}].type must be one of ${Array.from(ALLOWED_ACTION_TYPES).join(", ")} (got ${typeof raw.type === "string" ? `"${raw.type}"` : typeof raw.type})`,
    };
  }
  if (typeof raw.timestamp !== "string") {
    return { ok: false, message: `events[${index}].timestamp must be an ISO datetime string` };
  }
  const ts = new Date(raw.timestamp);
  if (Number.isNaN(ts.getTime())) {
    return { ok: false, message: `events[${index}].timestamp is not a valid ISO datetime` };
  }
  if (typeof raw.action !== "string") {
    return { ok: false, message: `events[${index}].action must be a string` };
  }
  // Bounded length on action so a runaway prompt-preview can't blow up
  // the DB row. ActivityLog.action is plain text in Postgres (no @db.Text
  // tag in the Prisma schema → Postgres `text` is still unbounded, but
  // we cap server-side for sanity).
  if (raw.action.length > 1024) {
    return { ok: false, message: `events[${index}].action exceeds 1024 chars` };
  }
  const agentId =
    typeof raw.agentId === "string" && raw.agentId.length > 0 ? raw.agentId : null;
  const runId = typeof raw.runId === "string" && raw.runId.length > 0 ? raw.runId : null;
  const sessionKey =
    typeof raw.sessionKey === "string" && raw.sessionKey.length > 0 ? raw.sessionKey : null;
  const channelId =
    typeof raw.channelId === "string" && raw.channelId.length > 0 ? raw.channelId : null;
  const metadata =
    raw.metadata && typeof raw.metadata === "object" && !Array.isArray(raw.metadata)
      ? (raw.metadata as Record<string, unknown>)
      : {};
  return {
    ok: true,
    event: {
      type: raw.type,
      timestamp: ts,
      agentId,
      runId,
      sessionKey,
      channelId,
      action: raw.action,
      metadata,
    },
  };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  // ─── Auth ────────────────────────────────────────────────────────────
  const expected = process.env.ACTIVITY_PIPELINE_SECRET;
  if (!expected) {
    // Fail-closed: an unset env var must not collapse into "any header
    // passes" (req.headers.get returns null, and null !== undefined would
    // 401 anyway, but we want this loud so deploy-misconfig surfaces).
    log.error("ACTIVITY_PIPELINE_SECRET not configured; rejecting activity post");
    return apiError(
      "ACTIVITY_SECRET_UNCONFIGURED",
      "Activity secret not configured on this deployment",
      401,
    );
  }
  if (req.headers.get("X-Activity-Secret") !== expected) {
    return apiError("UNAUTHORIZED", "Invalid activity secret", 401);
  }

  // ─── Resolve params ──────────────────────────────────────────────────
  const { workspaceId } = await params;
  if (!workspaceId || typeof workspaceId !== "string") {
    return apiError("VALIDATION_ERROR", "workspaceId path segment is required", 400);
  }

  // ─── Workspace existence ─────────────────────────────────────────────
  // Rejecting with 404 here keeps the secret usable across all workspaces
  // without leaking "this workspace exists in another tenant".
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true },
  });
  if (!workspace) {
    return apiError("WORKSPACE_NOT_FOUND", `Workspace ${workspaceId} not found`, 404);
  }

  // ─── Parse + validate body ───────────────────────────────────────────
  let body: { events?: unknown };
  try {
    body = (await req.json()) as { events?: unknown };
  } catch {
    return apiError("VALIDATION_ERROR", "Request body must be JSON", 400);
  }

  if (!body || !Array.isArray(body.events)) {
    return apiError("VALIDATION_ERROR", "events must be an array", 400);
  }
  if (body.events.length === 0) {
    return apiError("VALIDATION_ERROR", "events must contain at least 1 event", 400);
  }
  if (body.events.length > MAX_BATCH) {
    return apiError("VALIDATION_ERROR", `events exceeds max batch size (${MAX_BATCH})`, 400);
  }

  // Validate each event up front so a malformed batch is rejected atomically
  // (vs partially-applied). This keeps the contract simple: 200 means all
  // events in the batch were accepted; 4xx means none were.
  const validated: ValidatedEvent[] = [];
  for (let i = 0; i < body.events.length; i++) {
    const result = validateEvent(body.events[i] as IncomingEvent, i);
    if (!result.ok) {
      return apiError("VALIDATION_ERROR", result.message, 400);
    }
    validated.push(result.event);
  }

  // ─── Resolve OpenClaw agentId → Claws Agent row (single query, batch-scoped cache) ──
  //
  // The container sends `agentId` as the value of OpenClaw's hook
  // `ctx.agentId`. That value is built by
  // src/lib/openclaw/generator.ts:toAgentId(name) — which slugifies the
  // agent name with the SAME rule we use for Agent.agentSlug (see
  // toAgentId at generator.ts:116-122 vs the agentSlug values set by
  // src/app/api/workspaces/route.ts when creating template agents).
  //
  // So `event.agentId` here is `Agent.agentSlug` in our DB, NOT
  // `Agent.id` (which is a cuid). Resolve by agentSlug, scoped to this
  // workspace so we never cross-tenant.
  const distinctAgentSlugs = Array.from(
    new Set(validated.map((e) => e.agentId).filter((id): id is string => typeof id === "string")),
  );
  const agentRows =
    distinctAgentSlugs.length > 0
      ? await prisma.agent.findMany({
          where: { workspaceId, agentSlug: { in: distinctAgentSlugs } },
          select: { id: true, agentSlug: true, name: true },
        })
      : [];
  const agentInfoBySlug = new Map(agentRows.map((a) => [a.agentSlug, a]));

  // ─── Insert ──────────────────────────────────────────────────────────
  // One row per event. Could use createMany for slightly better throughput
  // but createMany doesn't return the created rows and we don't need a
  // transaction for the batch (each event is independent — if one insert
  // fails, the others are still legitimate writes). Stay with per-event
  // for simplicity; revisit if throughput becomes an issue.
  let processed = 0;
  const errors: Array<{ index: number; error: string }> = [];
  for (let i = 0; i < validated.length; i++) {
    const ev = validated[i];
    const agent = ev.agentId ? agentInfoBySlug.get(ev.agentId) : undefined;
    try {
      await prisma.activityLog.create({
        data: {
          workspaceId, // from URL path — NOT from payload, prevents cross-tenant writes
          agentName: agent?.name ?? null,
          // Persist the slug even when the workspace doesn't have a matching
          // Agent row (the plugin saw an agentId we no longer have). The
          // dashboard filters by agentSlug, so a stale row is still
          // attributable to the right agent slot.
          agentSlug: agent?.agentSlug ?? ev.agentId ?? null,
          action: ev.action,
          actionType: ev.type,
          metadata: JSON.stringify({
            ...ev.metadata,
            runId: ev.runId,
            sessionKey: ev.sessionKey,
            channelId: ev.channelId,
            sourceAgentId: ev.agentId,
          }),
          timestamp: ev.timestamp,
          // apiCost intentionally not set — PR-2b will wire cost separately.
          apiCost: null,
        },
      });
      processed++;
    } catch (err) {
      errors.push({
        index: i,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (errors.length > 0) {
    log.error("activity batch had row-level failures", {
      workspaceId,
      processed,
      failed: errors.length,
      firstError: errors[0],
    });
  } else {
    log.info("activity batch processed", { workspaceId, processed });
  }

  return apiSuccess({
    processed,
    received: validated.length,
    rowFailures: errors.length,
  });
}
