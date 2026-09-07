import { prisma } from "@/lib/db"
import {
  HTTP_ACTION_EVENT_KIND,
  type HttpActionCardView,
} from "@/lib/openclaw/http-action-card"
import { httpBodyHash } from "@/lib/openclaw/http-ledger"
import { normalizeHttpHost, normalizeHttpPath } from "@/lib/openclaw/http-contract"
import { permitCoversCall, type HttpPermitView } from "@/lib/openclaw/http-rail"

export const HTTP_PERMIT_EVENT_KIND = "http_permit"

export interface HttpPermit extends HttpPermitView {
  eventKind: typeof HTTP_PERMIT_EVENT_KIND
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function parseHttpPermit(metadata: string | null | undefined): HttpPermit | null {
  if (!metadata) return null
  try {
    const raw = JSON.parse(metadata) as unknown
    if (!isRecord(raw)) return null
    const permit = isRecord(raw.httpPermit) ? raw.httpPermit : raw
    if (typeof permit.skill !== "string") return null
    if (typeof permit.method !== "string") return null
    if (typeof permit.host !== "string") return null
    if (typeof permit.path !== "string") return null
    if (typeof permit.bodyHash !== "string") return null
    const consumedAt = permit.consumedAt
    return {
      eventKind: HTTP_PERMIT_EVENT_KIND,
      skill: permit.skill,
      method: permit.method,
      host: permit.host,
      path: permit.path,
      bodyHash: permit.bodyHash,
      consumedAt: typeof consumedAt === "string" ? consumedAt : null,
    }
  } catch {
    return null
  }
}

export function buildHttpPermit(args: {
  card: HttpActionCardView
  bodyHash: string
}): HttpPermit {
  return {
    eventKind: HTTP_PERMIT_EVENT_KIND,
    skill: args.card.skill,
    method: args.card.method,
    host: args.card.host,
    path: args.card.path,
    bodyHash: args.bodyHash,
    consumedAt: null,
  }
}

export function markPermitConsumed(permit: HttpPermit, at: string): HttpPermit {
  return { ...permit, consumedAt: at }
}

export function permitMatchesEndpoint(
  permit: HttpPermitView,
  args: { skill: string; method: string; host: string; path: string },
): boolean {
  return (
    permit.skill === args.skill &&
    permit.method === args.method.trim().toUpperCase() &&
    permit.host === normalizeHttpHost(args.host) &&
    permit.path === normalizeHttpPath(args.path)
  )
}

export function permitMatchesCall(
  permit: HttpPermitView,
  args: { skill: string; method: string; host: string; path: string; body: unknown },
): boolean {
  return permitCoversCall(permit, args)
}

export type ResolvedHttpPermit =
  | { kind: "unused"; id: string; permit: HttpPermit; metadata: string }
  | { kind: "consumed"; id: string; permit: HttpPermit; metadata: string }
  | { kind: "none" }

export async function resolveHttpPermit(args: {
  workspaceId: string
  skill: string
  method: string
  host: string
  path: string
  body: unknown
}): Promise<ResolvedHttpPermit> {
  const rows = await prisma.activityLog.findMany({
    where: {
      workspaceId: args.workspaceId,
      actionType: "HUMAN_APPROVE",
      metadata: { contains: `"eventKind":"${HTTP_PERMIT_EVENT_KIND}"` },
    },
    orderBy: { timestamp: "desc" },
    take: 40,
    select: { id: true, metadata: true },
  })
  let consumed: Extract<ResolvedHttpPermit, { kind: "consumed" }> | null = null
  const bodyHash = httpBodyHash(args.body)
  for (const row of rows) {
    const permit = parseHttpPermit(row.metadata)
    if (!permit) continue
    if (!permitMatchesEndpoint(permit, args)) continue
    const metadata = row.metadata ?? ""
    if (!permit.consumedAt) {
      return { kind: "unused", id: row.id, permit, metadata }
    }
    if (permit.bodyHash === bodyHash && !consumed) {
      consumed = { kind: "consumed", id: row.id, permit, metadata }
    }
  }
  return consumed ?? { kind: "none" }
}

export async function issueHttpPermitOnApprove(args: {
  workspaceId: string
  requestId: string
  respondedBy: string
  card: HttpActionCardView
  bodyHash: string
}): Promise<{ id: string; permit: HttpPermit }> {
  const permit = buildHttpPermit({ card: args.card, bodyHash: args.bodyHash })
  const row = await prisma.activityLog.create({
    data: {
      workspaceId: args.workspaceId,
      action: `Human approved: ${args.card.method} ${args.card.host}${args.card.path}`,
      actionType: "HUMAN_APPROVE",
      metadata: JSON.stringify({
        eventKind: HTTP_PERMIT_EVENT_KIND,
        originalRequestId: args.requestId,
        respondedBy: args.respondedBy,
        respondedAt: new Date().toISOString(),
        httpPermit: permit,
      }),
    },
    select: { id: true },
  })
  return { id: row.id, permit }
}

export async function consumeHttpPermit(args: {
  workspaceId: string
  skill: string
  method: string
  host: string
  path: string
  body: unknown
}): Promise<{ ok: true; permit: HttpPermit } | { ok: false; reason: "missing" | "consumed" | "mismatch" }> {
  const found = await resolveHttpPermit(args)
  if (found.kind === "none") return { ok: false, reason: "missing" }
  if (found.kind === "consumed") return { ok: false, reason: "consumed" }
  if (!permitMatchesCall(found.permit, args)) return { ok: false, reason: "mismatch" }
  const consumedAt = new Date().toISOString()
  const next = markPermitConsumed(found.permit, consumedAt)
  let previous: Record<string, unknown> = {}
  try {
    previous = JSON.parse(found.metadata) as Record<string, unknown>
  } catch {
    previous = { eventKind: HTTP_PERMIT_EVENT_KIND }
  }
  const updated = await prisma.activityLog.updateMany({
    where: {
      id: found.id,
      workspaceId: args.workspaceId,
      metadata: { contains: `"consumedAt":null` },
    },
    data: {
      metadata: JSON.stringify({
        ...previous,
        eventKind: HTTP_PERMIT_EVENT_KIND,
        httpPermit: next,
        consumedAt,
      }),
    },
  })
  if (updated.count !== 1) return { ok: false, reason: "consumed" }
  return { ok: true, permit: next }
}

export function isHttpActionRequestMetadata(metadata: string | null | undefined): boolean {
  if (!metadata) return false
  return metadata.includes(`"eventKind":"${HTTP_ACTION_EVENT_KIND}"`)
}

export function bodyHashFromHttpActionMetadata(metadata: string | null | undefined): string | null {
  if (!metadata) return null
  try {
    const raw = JSON.parse(metadata) as unknown
    if (!isRecord(raw)) return null
    return typeof raw.bodyHash === "string" ? raw.bodyHash : null
  } catch {
    return null
  }
}
