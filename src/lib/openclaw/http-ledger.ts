import { createHash, randomBytes } from "node:crypto"
import type { HttpClass } from "@/lib/openclaw/http-contract"

export const HTTP_LEDGER_EVENT_KIND = "http_tool_call"

export interface HttpLedgerRow {
  eventKind: typeof HTTP_LEDGER_EVENT_KIND
  toolId: string
  skill: string
  method: string
  host: string
  path: string
  class: HttpClass
  status: "ok" | "denied" | "pending" | "error"
  httpStatus?: number
  errorCode?: string
  bytes: number
  durationMs: number
}

export function mintHttpToolId(skill: string, opts?: { fixture?: boolean }): string {
  const slug = skill.trim() || "http"
  const hex = randomBytes(6).toString("hex")
  return opts?.fixture ? `tool:fixture:${slug}:${hex}` : `tool:${slug}:${hex}`
}

export function httpBodyHash(body: unknown): string {
  const serialized =
    typeof body === "string" ? body : body == null ? "" : JSON.stringify(body)
  return createHash("sha256").update(serialized, "utf8").digest("hex")
}

export function buildHttpLedgerRow(args: {
  toolId: string
  skill: string
  method: string
  host: string
  path: string
  class: HttpClass
  status: HttpLedgerRow["status"]
  httpStatus?: number
  errorCode?: string
  bytes: number
  durationMs: number
}): HttpLedgerRow {
  return {
    eventKind: HTTP_LEDGER_EVENT_KIND,
    toolId: args.toolId,
    skill: args.skill,
    method: args.method.trim().toUpperCase(),
    host: args.host,
    path: args.path,
    class: args.class,
    status: args.status,
    bytes: args.bytes,
    durationMs: args.durationMs,
    ...(args.httpStatus != null ? { httpStatus: args.httpStatus } : {}),
    ...(args.errorCode ? { errorCode: args.errorCode } : {}),
  }
}

export function parseHttpLedgerFromMetadata(metadata: string | null | undefined): HttpLedgerRow | null {
  if (!metadata) return null
  try {
    const raw = JSON.parse(metadata) as Partial<HttpLedgerRow>
    if (raw.eventKind !== HTTP_LEDGER_EVENT_KIND) return null
    if (typeof raw.toolId !== "string" || !raw.toolId.startsWith("tool:")) return null
    if (typeof raw.skill !== "string") return null
    if (raw.class !== "READ" && raw.class !== "ACTION") return null
    return raw as HttpLedgerRow
  } catch {
    return null
  }
}

export function claimsSourceMatchesLedger(source: string, row: HttpLedgerRow): boolean {
  return source.trim() === row.toolId
}
