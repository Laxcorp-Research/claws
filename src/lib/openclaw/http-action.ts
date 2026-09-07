import { prisma } from "@/lib/db"
import { httpContractForSkill } from "@/lib/openclaw/skill-http-contracts"
import { parseHttpTarget } from "@/lib/openclaw/http-contract"
import {
  evaluateHttpCall,
  type HttpRailDecision,
  type HttpRailDenyReason,
} from "@/lib/openclaw/http-rail"
import {
  buildHttpLedgerRow,
  HTTP_LEDGER_EVENT_KIND,
  httpBodyHash,
  mintHttpToolId,
  type HttpLedgerRow,
} from "@/lib/openclaw/http-ledger"
import {
  HTTP_ACTION_EVENT_KIND,
  httpActionRequestMetadata,
  isHttpActionCardRenderable,
  parseHttpActionCardFromMetadata,
  type HttpActionCardView,
} from "@/lib/openclaw/http-action-card"
import { consumeHttpPermit, resolveHttpPermit } from "@/lib/openclaw/http-permit"

export type HttpGateOp = "gate" | "ledger"

export type HttpGateResult = {
  status: "allow" | "deny" | "pending"
  toolId: string
  class?: "READ" | "ACTION"
  reason?: HttpRailDenyReason
  card?: HttpActionCardView
  requestId?: string
  ledgerId?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export async function writeHttpLedger(args: {
  workspaceId: string
  row: HttpLedgerRow
  agentSlug?: string | null
}): Promise<{ id: string }> {
  const created = await prisma.activityLog.create({
    data: {
      workspaceId: args.workspaceId,
      agentSlug: args.agentSlug ?? null,
      action: `http ${args.row.class} ${args.row.skill} ${args.row.method} ${args.row.host}${args.row.path}`,
      detail: args.row.toolId,
      actionType: "SKILL_INVOKED",
      metadata: JSON.stringify(args.row),
    },
    select: { id: true },
  })
  return created
}

async function findOpenHttpActionRequest(args: {
  workspaceId: string
  skill: string
  method: string
  host: string
  path: string
  bodyHash: string
}): Promise<string | null> {
  const rows = await prisma.activityLog.findMany({
    where: {
      workspaceId: args.workspaceId,
      actionType: "HUMAN_REQUEST",
      metadata: { contains: `"eventKind":"${HTTP_ACTION_EVENT_KIND}"` },
    },
    orderBy: { timestamp: "desc" },
    take: 40,
    select: { id: true, metadata: true },
  })
  const responses = await prisma.activityLog.findMany({
    where: {
      workspaceId: args.workspaceId,
      actionType: { in: ["HUMAN_APPROVE", "HUMAN_REJECT"] },
    },
    select: { metadata: true },
  })
  const done = new Set<string>()
  for (const row of responses) {
    if (!row.metadata) continue
    try {
      const meta = JSON.parse(row.metadata) as { originalRequestId?: unknown }
      if (typeof meta.originalRequestId === "string") done.add(meta.originalRequestId)
    } catch {
      /* skip */
    }
  }
  for (const row of rows) {
    if (done.has(row.id)) continue
    const card = parseHttpActionCardFromMetadata(row.metadata)
    if (!card) continue
    if (card.skill !== args.skill) continue
    if (card.method !== args.method) continue
    if (card.host !== args.host) continue
    if (card.path !== args.path) continue
    try {
      const meta = JSON.parse(row.metadata ?? "{}") as { bodyHash?: unknown }
      if (meta.bodyHash === args.bodyHash) return row.id
    } catch {
      continue
    }
  }
  return null
}

export async function createHttpActionRequest(args: {
  workspaceId: string
  card: HttpActionCardView
  bodyHash: string
  toolId: string
  agentSlug?: string | null
}): Promise<{ id: string }> {
  if (!isHttpActionCardRenderable(args.card)) {
    throw new Error("missing body")
  }
  const existing = await findOpenHttpActionRequest({
    workspaceId: args.workspaceId,
    skill: args.card.skill,
    method: args.card.method,
    host: args.card.host,
    path: args.card.path,
    bodyHash: args.bodyHash,
  })
  if (existing) return { id: existing }
  const row = await prisma.activityLog.create({
    data: {
      workspaceId: args.workspaceId,
      agentSlug: args.agentSlug ?? null,
      action: `HTTP ACTION: ${args.card.method} ${args.card.host}${args.card.path}`,
      detail: args.card.bodyPlain,
      actionType: "HUMAN_REQUEST",
      metadata: JSON.stringify({
        ...httpActionRequestMetadata({
          card: args.card,
          bodyHash: args.bodyHash,
          method: args.card.method,
        }),
        toolId: args.toolId,
      }),
    },
    select: { id: true },
  })
  return row
}

export async function gateHttpCall(args: {
  workspaceId: string
  skill: string
  method: string
  url?: string
  host?: string
  path?: string
  headers?: Record<string, string>
  body?: unknown
  agentSlug?: string | null
}): Promise<HttpGateResult> {
  const target = parseHttpTarget({ url: args.url, host: args.host, path: args.path })
  const contract = httpContractForSkill(args.skill)
  const toolId = mintHttpToolId(args.skill)
  if (!target) {
    const denied = await writeDeniedLedger({
      workspaceId: args.workspaceId,
      toolId,
      skill: args.skill,
      method: args.method,
      host: args.host ?? "",
      path: args.path ?? "/",
      reason: "undeclared",
      agentSlug: args.agentSlug,
    })
    return { status: "deny", reason: "undeclared", toolId, ledgerId: denied.id }
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: args.workspaceId },
    select: { deliveryMode: true },
  })
  const resolved = contract
    ? await resolveHttpPermit({
        workspaceId: args.workspaceId,
        skill: contract.skill,
        method: args.method,
        host: target.host,
        path: target.path,
        body: args.body,
      })
    : { kind: "none" as const }
  const permit = resolved.kind === "none" ? null : resolved.permit

  const decision = evaluateHttpCall({
    contract,
    skill: args.skill,
    method: args.method,
    host: target.host,
    path: target.path,
    headers: args.headers,
    body: args.body,
    deliveryMode: workspace?.deliveryMode ?? "APPROVAL_REQUIRED",
    permit,
    toolId,
  })

  return finalizeGateDecision({
    workspaceId: args.workspaceId,
    skill: args.skill,
    method: args.method,
    host: target.host,
    path: target.path,
    body: args.body,
    agentSlug: args.agentSlug,
    decision,
  })
}

async function finalizeGateDecision(args: {
  workspaceId: string
  skill: string
  method: string
  host: string
  path: string
  body?: unknown
  agentSlug?: string | null
  decision: HttpRailDecision
}): Promise<HttpGateResult> {
  const { decision } = args
  if (decision.status === "pending") {
    const request = await createHttpActionRequest({
      workspaceId: args.workspaceId,
      card: decision.card,
      bodyHash: httpBodyHash(args.body),
      toolId: decision.toolId,
      agentSlug: args.agentSlug,
    })
    const ledger = await writeHttpLedger({
      workspaceId: args.workspaceId,
      agentSlug: args.agentSlug,
      row: buildHttpLedgerRow({
        toolId: decision.toolId,
        skill: args.skill,
        method: args.method,
        host: args.host,
        path: args.path,
        class: "ACTION",
        status: "pending",
        bytes: 0,
        durationMs: 0,
      }),
    })
    return {
      status: "pending",
      class: "ACTION",
      toolId: decision.toolId,
      card: decision.card,
      requestId: request.id,
      ledgerId: ledger.id,
    }
  }

  if (decision.status === "deny") {
    const ledger = await writeDeniedLedger({
      workspaceId: args.workspaceId,
      toolId: decision.toolId,
      skill: args.skill,
      method: args.method,
      host: args.host,
      path: args.path,
      reason: decision.reason,
      agentSlug: args.agentSlug,
    })
    return {
      status: "deny",
      reason: decision.reason,
      toolId: decision.toolId,
      ledgerId: ledger.id,
    }
  }

  if (decision.class === "ACTION") {
    const consumed = await consumeHttpPermit({
      workspaceId: args.workspaceId,
      skill: args.skill,
      method: args.method,
      host: args.host,
      path: args.path,
      body: args.body,
    })
    if (!consumed.ok) {
      const ledger = await writeDeniedLedger({
        workspaceId: args.workspaceId,
        toolId: decision.toolId,
        skill: args.skill,
        method: args.method,
        host: args.host,
        path: args.path,
        reason: consumed.reason === "consumed" ? "permit_consumed" : "permit_mismatch",
        agentSlug: args.agentSlug,
      })
      return {
        status: "deny",
        reason: consumed.reason === "consumed" ? "permit_consumed" : "permit_mismatch",
        toolId: decision.toolId,
        ledgerId: ledger.id,
      }
    }
  }

  return { status: "allow", class: decision.class, toolId: decision.toolId }
}

async function writeDeniedLedger(args: {
  workspaceId: string
  toolId: string
  skill: string
  method: string
  host: string
  path: string
  reason: HttpRailDenyReason
  agentSlug?: string | null
}): Promise<{ id: string }> {
  return writeHttpLedger({
    workspaceId: args.workspaceId,
    agentSlug: args.agentSlug,
    row: buildHttpLedgerRow({
      toolId: args.toolId,
      skill: args.skill,
      method: args.method,
      host: args.host,
      path: args.path,
      class: args.reason === "undeclared" || args.reason === "caller_auth" ? "READ" : "ACTION",
      status: "denied",
      errorCode: args.reason,
      bytes: 0,
      durationMs: 0,
    }),
  })
}

export function parseLedgerOp(raw: unknown): {
  toolId: string
  skill: string
  method: string
  host: string
  path: string
  class: "READ" | "ACTION"
  status: HttpLedgerRow["status"]
  httpStatus?: number
  errorCode?: string
  bytes: number
  durationMs: number
} | null {
  if (!isRecord(raw)) return null
  if (typeof raw.toolId !== "string" || !raw.toolId.startsWith("tool:")) return null
  if (typeof raw.skill !== "string") return null
  if (typeof raw.method !== "string") return null
  const target = parseHttpTarget({
    url: typeof raw.url === "string" ? raw.url : undefined,
    host: typeof raw.host === "string" ? raw.host : undefined,
    path: typeof raw.path === "string" ? raw.path : undefined,
  })
  if (!target) return null
  if (raw.class !== "READ" && raw.class !== "ACTION") return null
  if (raw.status !== "ok" && raw.status !== "denied" && raw.status !== "pending" && raw.status !== "error") {
    return null
  }
  const bytes = typeof raw.bytes === "number" && Number.isFinite(raw.bytes) ? raw.bytes : 0
  const durationMs =
    typeof raw.durationMs === "number" && Number.isFinite(raw.durationMs) ? raw.durationMs : 0
  return {
    toolId: raw.toolId,
    skill: raw.skill,
    method: raw.method,
    host: target.host,
    path: target.path,
    class: raw.class,
    status: raw.status,
    bytes,
    durationMs,
    ...(typeof raw.httpStatus === "number" ? { httpStatus: raw.httpStatus } : {}),
    ...(typeof raw.errorCode === "string" ? { errorCode: raw.errorCode } : {}),
  }
}

export { HTTP_LEDGER_EVENT_KIND }
