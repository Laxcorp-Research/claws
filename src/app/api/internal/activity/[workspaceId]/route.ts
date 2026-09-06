// PR-2: Activity Wire bridge - receives batched events from the in-container
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
// Allowed actionType subset (8 of 21 - see ALLOWED_ACTION_TYPES below).
// apiCost: written from metadata.usage.costTotal when present (finite ≥ 0,
// ≤ $50/event). No pricing-table fallback here - costTotal is the truth
// source; client-side models.ts estimation covers historical null rows.
// Backfill: NOT in this PR. Staging had 11 ActivityLog rows with costTotal
// in metadata that WOULD be eligible for a later backfill script.

import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { apiSuccess, apiError } from "@/lib/api/response";
import { log } from "@/lib/logger";
import type { ActivityType } from "@/generated/prisma/client";
import { getToolBySlug } from "@/data/tool-catalog";
import { MAX_API_COST_PER_EVENT } from "@/lib/activity-cost-display";
import {
  isExternalChannelInbound,
  touchLastChannelMessageAt,
} from "@/lib/hibernation/channel-inbound";
import {
  computeNextHeartbeatAt,
  isHeartbeatBeatEvidence,
  isHeartbeatShapedActivity,
} from "@/lib/hibernation/next-heartbeat";
import {
  decideThinkingSignatureHeal,
  THINKING_SIGNATURE_HEAL_DEDUP_MS,
  THINKING_SIGNATURE_POISON_EVENT_KIND,
} from "@/lib/trial/thinking-signature-heal";
import { scheduleThinkingSignatureHeal } from "@/lib/healing/runtime-heals";
import {
  decideCronJobFailedAlert,
  extractCronJobName,
  isCronJobFailedEvent,
  CRON_JOB_FAILED_WINDOW_MS,
} from "@/lib/alerts/cron-job-failed-detect";
import { sendCriticalAlert } from "@/lib/alerts/critical-alert-push";
import { sendCustomerNudge } from "@/lib/alerts/customer-nudge";
import { applyWorkspaceApiCost } from "@/lib/healing/spend-limit";
import { NEAR_CAP_METADATA_KIND } from "@/lib/openclaw/near-cap-alert";
import { eventSignalsUserMdInterviewComplete } from "@/lib/user-md-interview";
import { nudgeDeliverableSyncNow } from "@/lib/artifacts/nudge-sync-now";
import { applyInboundApprovalCommand } from "@/lib/artifacts/approval-command";
import { twitterNudgeFromActivity } from "@/lib/tools/twitter-api-honesty";
import { stripHostMachineryPaths } from "@/lib/security/sanitize";

// ─── Event-type allowlist ─────────────────────────────────────────────────
//
// The container plugin is allowed to emit these 8. Other ActivityType values
// are intentionally NOT here:
//   - SYSTEM            → emitted by agents/[workspaceId]/[id]/control/route.ts
//   - HUMAN_APPROVE     → emitted by workspaces/[id]/respond/route.ts
//   - HUMAN_REJECT      → emitted by workspaces/[id]/respond/route.ts
//   - HUMAN_REQUEST     → created from FileVersion id on extract (not this route)
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
  detail?: unknown;
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
  detail: string | null;
  metadata: Record<string, unknown>;
}

// PR-4: `detail` holds the full expand-on-click context behind the short
// `action`. The plugin caps at ~4000; we enforce a hard ceiling so a runaway
// payload can't bloat a DB row. Optional - most rows have no detail.
const MAX_DETAIL_LEN = 4096;

async function maybeCompleteUserMdInterview(
  workspaceId: string,
  ev: ValidatedEvent,
): Promise<void> {
  if (!eventSignalsUserMdInterviewComplete(ev)) return;
  await prisma.workspace.updateMany({
    where: { id: workspaceId, userMdInterviewCompletedAt: null },
    data: { userMdInterviewCompletedAt: new Date() },
  });
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
  // PR-4: optional `detail`. Absent/empty → null (no expand affordance).
  let detail: string | null = null;
  if (raw.detail !== undefined && raw.detail !== null) {
    if (typeof raw.detail !== "string") {
      return { ok: false, message: `events[${index}].detail must be a string` };
    }
    if (raw.detail.length > MAX_DETAIL_LEN) {
      return { ok: false, message: `events[${index}].detail exceeds ${MAX_DETAIL_LEN} chars` };
    }
    detail = raw.detail.length > 0 ? raw.detail : null;
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
      detail,
      metadata,
    },
  };
}

const NO_ACTIVE_CONNECTION_RE = /\bNo Active connection for toolkit=([A-Za-z0-9_-]+)/;

/**
 * Read apiCost from metadata.usage.costTotal (reporter emission).
 * Invalid / insane values → null + warn (row still written).
 */
export function resolveApiCostFromMetadata(
  metadata: Record<string, unknown>,
  workspaceId?: string,
): number | null {
  const usage = metadata.usage;
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;
  const raw = (usage as Record<string, unknown>).costTotal;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
    if (raw !== undefined) {
      log.warn("activity: rejecting non-finite/negative usage.costTotal", {
        workspaceId,
        costTotal: raw,
      });
    }
    return null;
  }
  if (raw > MAX_API_COST_PER_EVENT) {
    log.warn("activity: rejecting usage.costTotal over per-event sanity cap", {
      workspaceId,
      costTotal: raw,
      cap: MAX_API_COST_PER_EVENT,
    });
    return null;
  }
  return raw;
}

/** agent:<slug>:… → slug. Used when MESSAGE_RECEIVED omits top-level agentId. */
export function agentIdFromSessionKey(sessionKey: string | null): string | null {
  if (!sessionKey) return null;
  const m = /^agent:([^:]+):/.exec(sessionKey);
  return m?.[1] && m[1].length > 0 ? m[1] : null;
}

/**
 * Prefer top-level agentId; for MESSAGE_RECEIVED with a missing agentId
 * (the residual null-slug class), fall back to sessionKey / metadata.agentId.
 */
export function resolveEventAgentId(event: ValidatedEvent): string | null {
  if (event.agentId) return event.agentId;
  if (event.type === "MESSAGE_RECEIVED") {
    const fromSession = agentIdFromSessionKey(event.sessionKey);
    if (fromSession) return fromSession;
    const metaAgent = event.metadata.agentId;
    if (typeof metaAgent === "string" && metaAgent.length > 0) return metaAgent;
  }
  return null;
}

function extractNoActiveConnectionToolkit(detail: string | null): string | null {
  const match = detail?.match(NO_ACTIVE_CONNECTION_RE);
  return match?.[1]?.toLowerCase() ?? null;
}

function toolConnectionToolkitSlug(toolSlug: string): string {
  return (getToolBySlug(toolSlug)?.composioToolkitId ?? toolSlug).toLowerCase();
}

/**
 * DETECT + LEDGER for Anthropic thinking-signature poison (cry-forever crons).
 * Platform cannot rotate live sessions while RUNNING/WARM - ledger flags
 * needsImageHeal for the -11 overlay half. Dedup per sessionKey / 24h.
 */
export async function ledgerThinkingSignaturePoison(
  workspaceId: string,
  event: ValidatedEvent,
): Promise<void> {
  const metaError =
    typeof event.metadata.error === "string" ? event.metadata.error : null;
  const detectInput = {
    type: event.type,
    action: event.action,
    detail: event.detail,
    metadataError: metaError,
    sessionKey: event.sessionKey,
  };
  if (decideThinkingSignatureHeal({ event: detectInput, priorHealInWindow: false }).kind === "skip") {
    return;
  }

  const since = new Date(Date.now() - THINKING_SIGNATURE_HEAL_DEDUP_MS);
  const prior = await prisma.activityLog.findFirst({
    where: {
      workspaceId,
      actionType: "SYSTEM",
      timestamp: { gte: since },
      AND: [
        { metadata: { contains: `"eventKind":"${THINKING_SIGNATURE_POISON_EVENT_KIND}"` } },
        ...(event.sessionKey
          ? [{ metadata: { contains: event.sessionKey } }]
          : []),
      ],
    },
    select: { id: true },
  });

  const decision = decideThinkingSignatureHeal({
    event: detectInput,
    priorHealInWindow: Boolean(prior),
  });
  if (decision.kind !== "ledger") return;

  await prisma.activityLog.create({
    data: {
      workspaceId,
      agentSlug: event.agentId,
      action: "Thinking signature poison detected",
      detail:
        "Cron/LLM rejected for invalid thinking signature. Platform cannot rotate live sessions - flagged for -11 image self-heal (strip/retry).",
      actionType: "SYSTEM",
      timestamp: new Date(),
      metadata: JSON.stringify({
        eventKind: THINKING_SIGNATURE_POISON_EVENT_KIND,
        sessionKey: decision.sessionKey,
        needsImageHeal: true,
        platformRotated: false,
        sourceActionType: event.type,
        sourceAction: event.action,
      }),
    },
  });
  log.info("thinking_signature_poison ledgered", {
    workspaceId,
    sessionKey: decision.sessionKey,
  });
  const host = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { containerHost: true },
  });
  scheduleThinkingSignatureHeal(workspaceId, host?.containerHost ?? null);
}

/**
 * PR-B: critical-alert push for a cron job failing repeatedly (same job
 * name, 2+ MESSAGE_SENT failures within CRON_JOB_FAILED_WINDOW_MS -
 * includes the row just written by this request). Fire-and-forget: a push
 * failure must not fail the activity-wire batch.
 */
export async function checkCronJobFailedAndAlert(
  workspaceId: string,
  event: ValidatedEvent,
): Promise<void> {
  if (!isCronJobFailedEvent({ type: event.type, action: event.action, detail: event.detail })) {
    return;
  }
  const jobName = extractCronJobName(event.action, event.detail);

  const since = new Date(Date.now() - CRON_JOB_FAILED_WINDOW_MS);
  const recentFailureCount = await prisma.activityLog.count({
    where: {
      workspaceId,
      actionType: "MESSAGE_SENT",
      timestamp: { gte: since },
      action: { contains: jobName ? `Cron job "${jobName}"` : "Cron job " },
    },
  });

  if (!decideCronJobFailedAlert({ recentFailureCount })) return;

  sendCriticalAlert({
    workspaceId,
    alertKey: "cron-job-failed",
    detail: jobName ? `Job: ${jobName}` : undefined,
  }).catch((err) => {
    log.error("activity: sendCriticalAlert (cron-job-failed) failed", {
      workspaceId,
      jobName,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

async function markNoActiveComposioConnection(
  workspaceId: string,
  event: ValidatedEvent,
): Promise<void> {
  if (event.type !== "ERROR" && event.type !== "TASK_FAILED") return;

  const toolkitSlug = extractNoActiveConnectionToolkit(event.detail);
  if (!toolkitSlug) return;

  const candidates = await prisma.toolConnection.findMany({
    where: {
      workspaceId,
      connectionType: "OAUTH_COMPOSIO",
      status: "CONNECTED",
      composioConnectionId: { not: null },
    },
    select: {
      id: true,
      toolSlug: true,
    },
  });

  const match = candidates.find((connection) => toolConnectionToolkitSlug(connection.toolSlug) === toolkitSlug);
  if (!match) {
    log.warn("activity: no ToolConnection matched Composio no-active-connection error", {
      workspaceId,
      toolkitSlug,
    });
    return;
  }

  await prisma.toolConnection.update({
    where: { id: match.id },
    data: {
      status: "EXPIRED",
      lastConnectionCheckAt: new Date(),
      lastConnectionCheckResult: "EXPIRED",
      lastError: `Composio Tool Router reported no active connection for toolkit=${toolkitSlug}`,
    },
  });

  log.warn("activity: marked ToolConnection expired from Composio no-active-connection error", {
    workspaceId,
    toolSlug: match.toolSlug,
    toolkitSlug,
  });
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
  // src/lib/openclaw/generator.ts:toAgentId(name) - which slugifies the
  // agent name with the SAME rule we use for Agent.agentSlug (see
  // toAgentId at generator.ts:116-122 vs the agentSlug values set by
  // src/app/api/workspaces/route.ts when creating template agents).
  //
  // So `event.agentId` here is `Agent.agentSlug` in our DB, NOT
  // `Agent.id` (which is a cuid). Resolve by agentSlug, scoped to this
  // workspace so we never cross-tenant.
  const resolvedAgentIds = validated.map((e) => resolveEventAgentId(e));
  const distinctAgentSlugs = Array.from(
    new Set(resolvedAgentIds.filter((id): id is string => typeof id === "string")),
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
  // transaction for the batch (each event is independent - if one insert
  // fails, the others are still legitimate writes). Stay with per-event
  // for simplicity; revisit if throughput becomes an issue.
  let processed = 0;
  const errors: Array<{ index: number; error: string }> = [];
  for (let i = 0; i < validated.length; i++) {
    const ev = validated[i];
    const resolvedAgentId = resolvedAgentIds[i];
    const agent = resolvedAgentId ? agentInfoBySlug.get(resolvedAgentId) : undefined;
    const apiCost = resolveApiCostFromMetadata(ev.metadata, workspaceId);
    try {
      await prisma.activityLog.create({
        data: {
          workspaceId, // from URL path - NOT from payload, prevents cross-tenant writes
          agentName: agent?.name ?? null,
          // Persist the slug even when the workspace doesn't have a matching
          // Agent row (the plugin saw an agentId we no longer have). The
          // dashboard filters by agentSlug, so a stale row is still
          // attributable to the right agent slot.
          agentSlug: agent?.agentSlug ?? resolvedAgentId ?? null,
          action: stripHostMachineryPaths(ev.action),
          detail: ev.detail ? stripHostMachineryPaths(ev.detail) : ev.detail,
          actionType: ev.type,
          channelId: ev.channelId,
          metadata: JSON.stringify({
            ...ev.metadata,
            runId: ev.runId,
            sessionKey: ev.sessionKey,
            channelId: ev.channelId,
            sourceAgentId: resolvedAgentId,
          }),
          timestamp: ev.timestamp,
          apiCost,
        },
      });
      if (typeof apiCost === "number" && apiCost > 0) {
        try {
          await applyWorkspaceApiCost({ workspaceId, delta: apiCost });
        } catch (spendErr) {
          log.error("activity: spend-limit apply failed", {
            workspaceId,
            error: spendErr instanceof Error ? spendErr.message : String(spendErr),
          });
        }
      }
      if (ev.type === "TASK_COMPLETE") {
        try {
          await nudgeDeliverableSyncNow(workspaceId);
        } catch (nudgeErr) {
          log.error("activity: deliverable sync-now nudge failed", {
            workspaceId,
            error: nudgeErr instanceof Error ? nudgeErr.message : String(nudgeErr),
          });
        }
      }
      if (ev.type === "MESSAGE_RECEIVED") {
        try {
          await applyInboundApprovalCommand({
            workspaceId,
            text: ev.detail ?? ev.action,
            respondedBy: ev.channelId ?? "channel",
          });
        } catch (cmdErr) {
          log.error("activity: approval command failed", {
            workspaceId,
            error: cmdErr instanceof Error ? cmdErr.message : String(cmdErr),
          });
        }
      }
      const twitterNudge = twitterNudgeFromActivity({
        type: ev.type,
        action: ev.action,
        detail: ev.detail,
        metadata: JSON.stringify(ev.metadata ?? {}),
      });
      if (twitterNudge) {
        try {
          await sendCustomerNudge({ workspaceId, condition: twitterNudge });
        } catch (nudgeErr) {
          log.error("activity: twitter nudge failed", {
            workspaceId,
            condition: twitterNudge,
            error: nudgeErr instanceof Error ? nudgeErr.message : String(nudgeErr),
          });
        }
      }
      if (
        ev.type === "ERROR" &&
        typeof ev.metadata?.kind === "string" &&
        ev.metadata.kind === NEAR_CAP_METADATA_KIND
      ) {
        try {
          await sendCustomerNudge({ workspaceId, condition: "state-sync-near-cap" });
        } catch (nudgeErr) {
          log.error("activity: near-cap nudge failed", {
            workspaceId,
            error: nudgeErr instanceof Error ? nudgeErr.message : String(nudgeErr),
          });
        }
      }
      try {
        await markNoActiveComposioConnection(workspaceId, ev);
      } catch (markErr) {
        log.error("activity: failed to mark Composio no-active-connection error", {
          workspaceId,
          error: markErr instanceof Error ? markErr.message : String(markErr),
        });
      }
      try {
        await ledgerThinkingSignaturePoison(workspaceId, ev);
      } catch (healErr) {
        log.error("activity: failed to ledger thinking-signature poison", {
          workspaceId,
          error: healErr instanceof Error ? healErr.message : String(healErr),
        });
      }
      try {
        await maybeCompleteUserMdInterview(workspaceId, ev);
      } catch (interviewErr) {
        log.error("activity: failed to stamp userMdInterviewCompletedAt", {
          workspaceId,
          error: interviewErr instanceof Error ? interviewErr.message : String(interviewErr),
        });
      }
      // warmIdle honesty: stamp lastChannelMessageAt on external-channel inbound
      // (CHANNEL_IDS + webchat). Lands here - claws-activity-reporter → this route.
      if (isExternalChannelInbound(ev.type, ev.channelId)) {
        try {
          await touchLastChannelMessageAt(workspaceId, ev.timestamp);
        } catch (touchErr) {
          log.error("activity: failed to stamp lastChannelMessageAt", {
            workspaceId,
            error: touchErr instanceof Error ? touchErr.message : String(touchErr),
          });
        }
      }
      // Lifecycle P2.1: roll nextHeartbeatAt on heartbeat-shaped activity -
      // typed HEARTBEAT, overlay_boot, or TASK_START with OpenClaw poll marker.
      // Sticky miss: clear heartbeatMissedAt ONLY on beat evidence (not boot).
      const shaped = {
        type: ev.type,
        metadata: ev.metadata,
        action: ev.action,
        detail: ev.detail,
      }
      if (isHeartbeatShapedActivity(shaped)) {
        try {
          const state = await prisma.containerState.findUnique({
            where: { workspaceId },
            select: {
              heartbeatCronExpressions: true,
              heartbeatInterval: true,
            },
          });
          if (state) {
            const nextHeartbeatAt = computeNextHeartbeatAt({
              now: ev.timestamp,
              heartbeatCronExpressions: state.heartbeatCronExpressions,
              heartbeatIntervalMs: state.heartbeatInterval,
            });
            await prisma.containerState.update({
              where: { workspaceId },
              data: { nextHeartbeatAt },
            });
          }
          if (isHeartbeatBeatEvidence(shaped)) {
            await prisma.workspace.updateMany({
              where: { id: workspaceId, heartbeatMissedAt: { not: null } },
              data: { heartbeatMissedAt: null },
            });
          }
        } catch (rollErr) {
          log.error("activity: failed to roll nextHeartbeatAt", {
            workspaceId,
            error: rollErr instanceof Error ? rollErr.message : String(rollErr),
          });
        }
      }
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

export const __internal = {
  extractNoActiveConnectionToolkit,
  toolConnectionToolkitSlug,
  resolveApiCostFromMetadata,
  resolveEventAgentId,
  agentIdFromSessionKey,
  ledgerThinkingSignaturePoison,
  checkCronJobFailedAndAlert,
};
