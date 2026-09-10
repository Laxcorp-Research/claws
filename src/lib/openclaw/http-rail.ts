import {
  callerSuppliedForbiddenHeaders,
  matchHttpEndpoint,
  normalizeHttpHost,
  normalizeHttpPath,
  type HttpClass,
  type HttpSkillContract,
} from "@/lib/openclaw/http-contract"
import {
  AUTONOMOUS_CAPABLE_TOOLS,
  httpCallSupportsAutonomous,
} from "@/lib/openclaw/delivery-rail"
import { httpBodyHash, mintHttpToolId } from "@/lib/openclaw/http-ledger"
import {
  buildHttpActionCard,
  isHttpActionCardRenderable,
  type HttpActionCardView,
} from "@/lib/openclaw/http-action-card"

export type HttpRailDenyReason =
  | "undeclared"
  | "caller_auth"
  | "missing_body"
  | "permit_mismatch"
  | "permit_consumed"
  | "not_autonomous"
  | "notional-cap"
  | "risk-cap"
  | "invalid-size"
  | "equity-unknown"
  | "live-alpaca-host"
  | "missing-container-limits"
  | "fixture-miss"

export type HttpPermitView = {
  skill: string
  method: string
  host: string
  path: string
  bodyHash: string
  consumedAt: string | null
}

export type HttpRailDecision =
  | { status: "allow"; class: HttpClass; toolId: string }
  | { status: "deny"; reason: HttpRailDenyReason; toolId: string }
  | {
      status: "pending"
      class: "ACTION"
      toolId: string
      card: HttpActionCardView
    }

export function httpSkillSupportsAutonomous(skill: string): boolean {
  return (AUTONOMOUS_CAPABLE_TOOLS as readonly string[]).includes(skill)
}

export function permitCoversCall(
  permit: HttpPermitView,
  args: { skill: string; method: string; host: string; path: string; body?: unknown },
): boolean {
  if (permit.consumedAt) return false
  if (permit.skill !== args.skill) return false
  if (permit.method !== args.method.trim().toUpperCase()) return false
  if (permit.host !== normalizeHttpHost(args.host)) return false
  if (permit.path !== normalizeHttpPath(args.path)) return false
  return permit.bodyHash === httpBodyHash(args.body)
}

export function evaluateHttpCall(args: {
  contract: HttpSkillContract | null
  skill?: string
  method: string
  host: string
  path: string
  headers?: Record<string, string>
  body?: unknown
  deliveryMode?: string | null
  permit?: HttpPermitView | null
  toolId?: string
  composioOverrides?: Readonly<Record<string, HttpClass>>
}): HttpRailDecision {
  const skill = args.contract?.skill ?? args.skill ?? "http"
  const toolId = args.toolId ?? mintHttpToolId(skill)
  const forbidden = callerSuppliedForbiddenHeaders(args.headers)
  if (forbidden.length > 0) {
    return { status: "deny", reason: "caller_auth", toolId }
  }
  if (!args.contract) {
    return { status: "deny", reason: "undeclared", toolId }
  }
  const endpoint = matchHttpEndpoint(
    args.contract,
    {
      method: args.method,
      host: args.host,
      path: args.path,
    },
    { composioOverrides: args.composioOverrides },
  )
  if (!endpoint) {
    return { status: "deny", reason: "undeclared", toolId }
  }
  if (endpoint.class === "READ") {
    return { status: "allow", class: "READ", toolId }
  }

  const card = buildHttpActionCard({
    skill: args.contract.skill,
    method: args.method,
    host: args.host,
    path: args.path,
    body: args.body,
  })
  if (!isHttpActionCardRenderable(card)) {
    return { status: "deny", reason: "missing_body", toolId }
  }

  const autonomousCall =
    args.deliveryMode === "AUTO_PROCEED" &&
    httpCallSupportsAutonomous({
      skill: args.contract.skill,
      method: args.method,
      host: args.host,
      path: args.path,
    })

  if (args.permit) {
    if (args.permit.consumedAt) {
      return { status: "deny", reason: "permit_consumed", toolId }
    }
    if (
      permitCoversCall(args.permit, {
        skill: args.contract.skill,
        method: args.method,
        host: args.host,
        path: args.path,
        body: args.body,
      })
    ) {
      return { status: "allow", class: "ACTION", toolId }
    }
    if (!autonomousCall) {
      return { status: "deny", reason: "permit_mismatch", toolId }
    }
  }

  if (autonomousCall) {
    return { status: "allow", class: "ACTION", toolId }
  }

  if (args.deliveryMode === "AUTO_PROCEED" && !httpSkillSupportsAutonomous(args.contract.skill)) {
    return { status: "deny", reason: "not_autonomous", toolId }
  }

  return { status: "pending", class: "ACTION", toolId, card }
}
