// Claws HTTP - OpenClaw overlay plugin.
//
// Loaded at /opt/claws-http/ via plugins.load.paths. Registers the `http`
// tool. The control plane (POST /api/internal/http-action/:workspaceId)
// is the allow/deny source of truth. This plugin injects auth, caps size,
// and returns typed 401/402/403/429/5xx codes.

import {
  applyAuthProfile,
  applySearchParams,
  callerSuppliedForbiddenHeaders,
  capResponseBytes,
  classifyHttpStatus,
  httpActionUrl,
  MAX_429_RETRIES,
  parseRetryAfterMs,
  resolveAuthProfile,
  structuredError,
} from "./http-core.mjs"

const ENDPOINT_BASE = process.env.CLAWS_ACTIVITY_ENDPOINT
const ACTIVITY_SECRET = process.env.CLAWS_ACTIVITY_SECRET
const WORKSPACE_ID = process.env.CLAWS_WORKSPACE_ID

const HTTP_PARAMETERS = {
  type: "object",
  additionalProperties: false,
  required: ["skill", "method", "url"],
  properties: {
    skill: { type: "string", description: "Skill slug that owns this call (tavily-search, twitter-api, alpaca-trading, ...)" },
    method: { type: "string", description: "GET / POST / PUT / PATCH / DELETE" },
    url: { type: "string", description: "Absolute https URL" },
    headers: {
      type: "object",
      additionalProperties: { type: "string" },
      description: "Non-auth headers only. Authorization and provider keys are rejected.",
    },
    body: { description: "JSON body for POST/PUT/PATCH" },
  },
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function postControlPlane(op, payload, deps = {}) {
  const fetchFn = deps.fetch ?? fetch
  const endpoint = deps.activityEndpoint ?? ENDPOINT_BASE
  const secret = deps.activitySecret ?? ACTIVITY_SECRET
  const workspaceId = deps.workspaceId ?? WORKSPACE_ID
  if (!endpoint || !secret || !workspaceId) {
    return { ok: false, error: structuredError("AUTH", { message: "http control plane is not configured" }) }
  }
  const url = httpActionUrl(endpoint, workspaceId)
  const res = await fetchFn(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Activity-Secret": secret,
    },
    body: JSON.stringify({ op, ...payload }),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) {
    return {
      ok: false,
      error: structuredError("UPSTREAM", {
        httpStatus: res.status,
        message: json?.error?.message ?? `control plane ${res.status}`,
      }),
    }
  }
  return { ok: true, data: json?.data ?? json }
}

async function performHttp(args, deps = {}) {
  const fetchFn = deps.fetch ?? fetch
  const wait = deps.sleep ?? sleep
  const env = deps.env ?? process.env
  const started = Date.now()
  const forbidden = callerSuppliedForbiddenHeaders(args.headers)

  // Gate first so the control plane ledgers caller_auth / undeclared / pending.
  const gate = await postControlPlane(
    "gate",
    {
      skill: args.skill,
      method: args.method,
      url: args.url,
      headers: args.headers,
      body: args.body,
    },
    deps,
  )
  if (!gate.ok) {
    return {
      result: gate.error,
      ledger: { status: "error", errorCode: "UPSTREAM", bytes: 0, durationMs: Date.now() - started },
    }
  }

  const decision = gate.data
  if (forbidden.length > 0 && decision.status === "allow") {
    return {
      result: structuredError("AUTH", {
        message: "caller-supplied auth headers are rejected",
        headers: forbidden,
        toolId: decision.toolId,
      }),
      ledger: { status: "denied", errorCode: "caller_auth", bytes: 0, durationMs: Date.now() - started, toolId: decision.toolId },
    }
  }
  if (decision.status === "deny" || decision.status === "pending") {
    return {
      result: {
        ...structuredError(decision.status === "pending" ? "PENDING" : decision.reason?.toUpperCase?.() ?? "DENIED", {
          reason: decision.reason,
          toolId: decision.toolId,
          card: decision.card,
          requestId: decision.requestId,
        }),
        denied: true,
        pending: decision.status === "pending",
        toolId: decision.toolId,
        card: decision.card,
      },
      ledger: {
        status: decision.status === "pending" ? "pending" : "denied",
        errorCode: decision.reason,
        bytes: 0,
        durationMs: Date.now() - started,
        toolId: decision.toolId,
        class: decision.class,
      },
      skipLedger: true,
    }
  }

  const profile = resolveAuthProfile(args.skill)
  const authed = applyAuthProfile({ profile, env, headers: args.headers, body: args.body })
  if (!authed.ok) {
    await postControlPlane(
      "ledger",
      {
        toolId: decision.toolId,
        skill: args.skill,
        method: args.method,
        url: args.url,
        class: decision.class ?? "READ",
        status: "error",
        errorCode: authed.code,
        bytes: 0,
        durationMs: Date.now() - started,
      },
      deps,
    )
    return {
      result: structuredError(authed.code, { message: authed.message, toolId: decision.toolId }),
      skipLedger: true,
    }
  }

  let attempt = 0
  let lastRes = null
  let lastText = ""
  while (attempt <= MAX_429_RETRIES) {
    const init = {
      method: String(args.method).toUpperCase(),
      headers: { ...authed.headers },
    }
    if (authed.body != null && init.method !== "GET" && init.method !== "HEAD") {
      init.headers["Content-Type"] = init.headers["Content-Type"] ?? "application/json"
      init.body = typeof authed.body === "string" ? authed.body : JSON.stringify(authed.body)
    }
    lastRes = await fetchFn(applySearchParams(args.url, authed.searchParams), init)
    lastText = await lastRes.text()
    if (lastRes.status !== 429 || attempt === MAX_429_RETRIES) break
    const waitMs = parseRetryAfterMs(lastRes.headers.get?.("retry-after") ?? lastRes.headers.get?.("Retry-After"))
    await wait(waitMs)
    attempt += 1
  }

  const capped = capResponseBytes(lastText)
  const code = classifyHttpStatus(lastRes.status)
  const durationMs = Date.now() - started
  const toolId = decision.toolId
  await postControlPlane(
    "ledger",
    {
      toolId,
      skill: args.skill,
      method: args.method,
      url: args.url,
      class: decision.class ?? "READ",
      status: code ? "error" : "ok",
      httpStatus: lastRes.status,
      errorCode: code ?? undefined,
      bytes: capped.bytes,
      durationMs,
    },
    deps,
  )

  if (code) {
    return {
      result: structuredError(code, {
        httpStatus: lastRes.status,
        toolId,
        truncated: capped.truncated,
        body: capped.text,
      }),
      skipLedger: true,
    }
  }

  return {
    result: {
      ok: true,
      toolId,
      httpStatus: lastRes.status,
      truncated: capped.truncated,
      bytes: capped.bytes,
      body: capped.text,
    },
    skipLedger: true,
  }
}

const pluginEntry = {
  id: "claws-http",
  name: "Claws HTTP",
  description: "Authenticated HTTP with control-plane READ/ACTION gating.",
  configSchema: {
    type: "object",
    additionalProperties: false,
    properties: {},
  },
  register(api) {
    api.registerTool({
      name: "http",
      description:
        "Call a declared skill HTTP endpoint. Auth is injected. Do not pass Authorization or API keys. ACTION calls require human approval.",
      parameters: HTTP_PARAMETERS,
      async execute(_id, params) {
        const out = await performHttp(params)
        return { content: [{ type: "text", text: JSON.stringify(out.result) }] }
      },
    })
  },
}

export default pluginEntry

export const __test__ = {
  performHttp,
  postControlPlane,
  HTTP_PARAMETERS,
  applyAuthProfile,
  resolveAuthProfile,
  classifyHttpStatus,
  capResponseBytes,
  parseRetryAfterMs,
  httpActionUrl,
  callerSuppliedForbiddenHeaders,
}
