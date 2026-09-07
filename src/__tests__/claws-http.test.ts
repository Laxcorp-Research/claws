// INFRA-5 PR-3: claws-http overlay plugin.
// Lives at container/claws-http/; this file is under src/__tests__/ because
// vitest only includes src/**/*.test.ts.

import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"
import { OUTBOUND_ACTION_DENY } from "@/lib/openclaw/delivery-rail"
import {
  applyAuthProfile,
  capResponseBytes,
  classifyHttpStatus,
  callerSuppliedForbiddenHeaders,
  httpActionUrl,
  MAX_RESPONSE_BYTES,
  parseRetryAfterMs,
  resolveAuthProfile,
} from "../../container/claws-http/http-core.mjs"
import { __test__ as httpPlugin } from "../../container/claws-http/index.mjs"

type FetchCall = { url: string; init?: RequestInit }

function jsonResponse(status: number, body: unknown, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...(headers ?? {}) },
  })
}

function textResponse(status: number, body: string, headers?: Record<string, string>): Response {
  return new Response(body, { status, headers: headers ?? {} })
}

function splitCalls(calls: FetchCall[]) {
  const control = calls.filter((c) => c.url.includes("/http-action/"))
  const upstream = calls.filter((c) => !c.url.includes("/http-action/"))
  return { control, upstream }
}

function gateAllow(toolId = "tool:tavily-search:abc", klass: "READ" | "ACTION" = "READ") {
  return jsonResponse(200, { success: true, data: { status: "allow", class: klass, toolId } })
}

function gateDeny(reason: string, toolId = "tool:http:denied") {
  return jsonResponse(200, { success: true, data: { status: "deny", reason, toolId } })
}

function gatePending(toolId = "tool:alpaca-trading:ord1") {
  return jsonResponse(200, {
    success: true,
    data: {
      status: "pending",
      class: "ACTION",
      toolId,
      requestId: "req-1",
      card: {
        skill: "alpaca-trading",
        method: "POST",
        host: "paper-api.alpaca.markets",
        path: "/v2/orders",
        bodyPlain: "BUY 166 MU @ $1,017 stop $1,005",
      },
    },
  })
}

function ledgerOk() {
  return jsonResponse(200, { success: true, data: { id: "led-1", toolId: "tool:x", eventKind: "http_tool_call" } })
}

function controlPlaneFetch(plan: {
  gate: Response
  upstream?: Response | Response[]
}): { fetchFn: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = []
  const upstreamQueue = Array.isArray(plan.upstream) ? [...plan.upstream] : plan.upstream ? [plan.upstream] : []
  const fetchFn = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const href = String(url)
    calls.push({ url: href, init })
    if (href.includes("/http-action/")) {
      const op = JSON.parse(String(init?.body ?? "{}")) as { op?: string }
      if (op.op === "gate") return plan.gate
      if (op.op === "ledger") return ledgerOk()
      return jsonResponse(400, { error: { message: "bad op" } })
    }
    const next = upstreamQueue.shift()
    if (!next) throw new Error(`unexpected upstream fetch ${href}`)
    return next
  }) as unknown as typeof fetch
  return { fetchFn, calls }
}

const CP = {
  activityEndpoint: "https://staging.example/api/internal/activity",
  activitySecret: "secret",
  workspaceId: "ws-1",
}

describe("claws-http auth profiles", () => {
  it("bearer injects Authorization from TWITTER_API_KEY", () => {
    const out = applyAuthProfile({
      profile: resolveAuthProfile("twitter-api"),
      env: { TWITTER_API_KEY: "AAAA-live" },
      headers: { Accept: "application/json" },
    })
    expect(out).toEqual({
      ok: true,
      headers: { Accept: "application/json", Authorization: "Bearer AAAA-live" },
      body: undefined,
    })
  })

  it("alpaca dual-header injects APCA-API-KEY-ID and APCA-API-SECRET-KEY", () => {
    const out = applyAuthProfile({
      profile: resolveAuthProfile("alpaca-trading"),
      env: { ALPACA_API_KEY_ID: "PK-paper", ALPACA_API_SECRET_KEY: "SK-paper" },
    })
    expect(out.ok).toBe(true)
    if (!out.ok) throw new Error("expected ok")
    expect(out.headers["APCA-API-KEY-ID"]).toBe("PK-paper")
    expect(out.headers["APCA-API-SECRET-KEY"]).toBe("SK-paper")
  })

  it("tavily body key injects api_key and overwrites a caller-supplied key", () => {
    const out = applyAuthProfile({
      profile: resolveAuthProfile("tavily-search"),
      env: { TAVILY_API_KEY: "tvly-real" },
      body: { query: "MU", api_key: "llm-guess" },
    })
    expect(out).toEqual({
      ok: true,
      headers: {},
      body: { query: "MU", api_key: "tvly-real" },
    })
  })

  it("composio skill slugs resolve without a composio- prefix", () => {
    expect(resolveAuthProfile("gmail-ops")?.profile).toBe("composio")
    expect(resolveAuthProfile("hubspot-crm")?.profile).toBe("composio")
    expect(resolveAuthProfile("apollo-search")?.profile).toBe("x-api-key")
    expect(resolveAuthProfile("shopify-store")?.profile).toBe("shopify-admin")
  })

  it("shopify-admin injects X-Shopify-Access-Token and never echoes the token in errors", () => {
    const out = applyAuthProfile({
      profile: resolveAuthProfile("shopify-store"),
      env: { SHOPIFY_ADMIN_TOKEN: "shpat_fixture" },
    })
    expect(out.ok).toBe(true)
    if (!out.ok) throw new Error("expected ok")
    expect(out.headers["X-Shopify-Access-Token"]).toBe("shpat_fixture")
    const missing = applyAuthProfile({
      profile: resolveAuthProfile("shopify-store"),
      env: {},
    })
    expect(missing).toEqual({ ok: false, code: "AUTH", message: "SHOPIFY_ADMIN_TOKEN is not set" })
    expect(JSON.stringify(missing)).not.toMatch(/shpat_/)
  })

  it("composio injects X-API-Key plus user_id and connected_account_id", () => {
    const out = applyAuthProfile({
      profile: resolveAuthProfile("gmail-ops"),
      env: {
        COMPOSIO_API_KEY: "ck-live",
        COMPOSIO_USER_ID: "usr-1",
        COMPOSIO_CONNECTED_ACCOUNT_ID: "ca-gmail",
      },
      body: { arguments: { to: "a@b.com" } },
    })
    expect(out.ok).toBe(true)
    if (!out.ok) throw new Error("expected ok")
    expect(out.headers["X-API-Key"]).toBe("ck-live")
    expect(out.body).toEqual({
      arguments: { to: "a@b.com" },
      user_id: "usr-1",
      connected_account_id: "ca-gmail",
    })
  })

  it("composio still injects ids when the body is missing", () => {
    const out = applyAuthProfile({
      profile: resolveAuthProfile("composio-hubspot"),
      env: {
        COMPOSIO_API_KEY: "ck-live",
        COMPOSIO_USER_ID: "usr-1",
        COMPOSIO_CONNECTED_ACCOUNT_ID: "ca-hs",
      },
    })
    expect(out.ok).toBe(true)
    if (!out.ok) throw new Error("expected ok")
    expect(out.body).toEqual({ user_id: "usr-1", connected_account_id: "ca-hs" })
  })

  it("missing env returns AUTH and does not invent a header", () => {
    const twitter = applyAuthProfile({
      profile: resolveAuthProfile("twitter-api"),
      env: {},
    })
    expect(twitter).toEqual({ ok: false, code: "AUTH", message: "TWITTER_API_KEY is not set" })
  })
})

describe("claws-http structured errors and caps", () => {
  it("maps 401/402/403/429/5xx to typed codes", () => {
    expect(classifyHttpStatus(401)).toBe("AUTH")
    expect(classifyHttpStatus(402)).toBe("PAYMENT")
    expect(classifyHttpStatus(403)).toBe("SCOPE")
    expect(classifyHttpStatus(429)).toBe("RATE")
    expect(classifyHttpStatus(500)).toBe("UPSTREAM")
    expect(classifyHttpStatus(502)).toBe("UPSTREAM")
    expect(classifyHttpStatus(200)).toBeNull()
  })

  it("honors Retry-After seconds and caps the wait at 5s", () => {
    expect(parseRetryAfterMs("2")).toBe(2000)
    expect(parseRetryAfterMs("30")).toBe(5000)
    expect(parseRetryAfterMs(null)).toBe(1000)
  })

  it("caps response bytes at 256KiB", () => {
    const big = "x".repeat(MAX_RESPONSE_BYTES + 40)
    const capped = capResponseBytes(big)
    expect(capped.truncated).toBe(true)
    expect(capped.bytes).toBe(MAX_RESPONSE_BYTES + 40)
    expect(Buffer.byteLength(capped.text, "utf8")).toBe(MAX_RESPONSE_BYTES)
  })

  it("builds the http-action URL from the activity endpoint", () => {
    expect(httpActionUrl("https://app.example/api/internal/activity", "ws-9")).toBe(
      "https://app.example/api/internal/http-action/ws-9",
    )
  })

  it("lists Authorization and provider keys as forbidden caller headers", () => {
    expect(callerSuppliedForbiddenHeaders({ Authorization: "Bearer stolen" })).toEqual(["authorization"])
    expect(callerSuppliedForbiddenHeaders({ "X-API-Key": "x" })).toEqual(["x-api-key"])
    expect(callerSuppliedForbiddenHeaders({ "X-Shopify-Access-Token": "shpat_x" })).toEqual([
      "x-shopify-access-token",
    ])
  })
})

describe("claws-http performHttp", () => {
  it("READ allowed: injects bearer and does not send caller Authorization", async () => {
    const { fetchFn, calls } = controlPlaneFetch({
      gate: gateAllow("tool:twitter-api:r1"),
      upstream: textResponse(200, '{"data":[]}'),
    })
    const out = await httpPlugin.performHttp(
      {
        skill: "twitter-api",
        method: "GET",
        url: "https://api.twitter.com/2/tweets/search/recent?query=MU",
      },
      {
        ...CP,
        fetch: fetchFn,
        env: { TWITTER_API_KEY: "AAAA-live" },
      },
    )
    expect(out.result).toMatchObject({ ok: true, toolId: "tool:twitter-api:r1", httpStatus: 200 })
    const { upstream, control } = splitCalls(calls)
    expect(upstream).toHaveLength(1)
    const headers = new Headers(upstream[0]?.init?.headers)
    expect(headers.get("Authorization")).toBe("Bearer AAAA-live")
    expect(control.some((c) => JSON.parse(String(c.init?.body ?? "{}")).op === "ledger")).toBe(true)
  })

  it("LLM Authorization is rejected and never reaches the provider", async () => {
    const { fetchFn, calls } = controlPlaneFetch({
      gate: gateDeny("caller_auth", "tool:twitter-api:bad"),
    })
    const out = await httpPlugin.performHttp(
      {
        skill: "twitter-api",
        method: "GET",
        url: "https://api.twitter.com/2/tweets/search/recent?query=MU",
        headers: { Authorization: "Bearer llm-forged" },
      },
      { ...CP, fetch: fetchFn, env: { TWITTER_API_KEY: "AAAA-live" } },
    )
    expect(out.result).toMatchObject({
      denied: true,
      error: { code: "CALLER_AUTH", reason: "caller_auth", toolId: "tool:twitter-api:bad" },
    })
    expect(splitCalls(calls).upstream).toHaveLength(0)
  })

  it("gate deny / pending does not HTTP the provider", async () => {
    const denied = controlPlaneFetch({ gate: gateDeny("undeclared", "tool:http:u1") })
    const denyOut = await httpPlugin.performHttp(
      { skill: "unknown-skill", method: "GET", url: "https://example.com/secret" },
      { ...CP, fetch: denied.fetchFn, env: {} },
    )
    expect(denyOut.result).toMatchObject({ denied: true, error: { code: "UNDECLARED" } })
    expect(splitCalls(denied.calls).upstream).toHaveLength(0)

    const pending = controlPlaneFetch({ gate: gatePending() })
    const pendingOut = await httpPlugin.performHttp(
      {
        skill: "alpaca-trading",
        method: "POST",
        url: "https://paper-api.alpaca.markets/v2/orders",
        body: { side: "buy", qty: "166", symbol: "MU", limit_price: "1017", stop_price: "1005" },
      },
      { ...CP, fetch: pending.fetchFn, env: { ALPACA_API_KEY_ID: "PK", ALPACA_API_SECRET_KEY: "SK" } },
    )
    expect(pendingOut.result).toMatchObject({
      pending: true,
      denied: true,
      card: { bodyPlain: "BUY 166 MU @ $1,017 stop $1,005" },
    })
    expect(splitCalls(pending.calls).upstream).toHaveLength(0)
  })

  it("returns AUTH / PAYMENT / SCOPE / UPSTREAM from upstream status", async () => {
    for (const [status, code] of [
      [401, "AUTH"],
      [402, "PAYMENT"],
      [403, "SCOPE"],
      [503, "UPSTREAM"],
    ] as const) {
      const { fetchFn } = controlPlaneFetch({
        gate: gateAllow("tool:twitter-api:err"),
        upstream: textResponse(status, `{"error":"${code}"}`),
      })
      const out = await httpPlugin.performHttp(
        { skill: "twitter-api", method: "GET", url: "https://api.twitter.com/2/users/me" },
        { ...CP, fetch: fetchFn, env: { TWITTER_API_KEY: "AAAA-live" } },
      )
      expect(out.result).toMatchObject({ error: { code, httpStatus: status, toolId: "tool:twitter-api:err" } })
    }
  })

  it("429 honors Retry-After, retries bounded, then returns RATE", async () => {
    const waits: number[] = []
    const { fetchFn, calls } = controlPlaneFetch({
      gate: gateAllow("tool:tavily-search:rate"),
      upstream: [
        textResponse(429, "slow", { "Retry-After": "2" }),
        textResponse(429, "slow", { "Retry-After": "2" }),
        textResponse(429, "still slow", { "Retry-After": "2" }),
      ],
    })
    const out = await httpPlugin.performHttp(
      {
        skill: "tavily-search",
        method: "POST",
        url: "https://api.tavily.com/search",
        body: { query: "MU" },
      },
      {
        ...CP,
        fetch: fetchFn,
        sleep: async (ms: number) => {
          waits.push(ms)
        },
        env: { TAVILY_API_KEY: "tvly-real" },
      },
    )
    expect(out.result).toMatchObject({ error: { code: "RATE", httpStatus: 429 } })
    expect(waits).toEqual([2000, 2000])
    expect(splitCalls(calls).upstream).toHaveLength(3)
    const posted = JSON.parse(String(splitCalls(calls).upstream[0]?.init?.body ?? "{}")) as { api_key?: string }
    expect(posted.api_key).toBe("tvly-real")
  })

  it("size cap truncates an oversize 200 body", async () => {
    const { fetchFn } = controlPlaneFetch({
      gate: gateAllow("tool:tavily-search:big"),
      upstream: textResponse(200, "n".repeat(MAX_RESPONSE_BYTES + 8)),
    })
    const out = await httpPlugin.performHttp(
      {
        skill: "tavily-search",
        method: "POST",
        url: "https://api.tavily.com/search",
        body: { query: "MU" },
      },
      { ...CP, fetch: fetchFn, env: { TAVILY_API_KEY: "tvly-real" } },
    )
    expect(out.result).toMatchObject({ ok: true, truncated: true, toolId: "tool:tavily-search:big" })
    expect(typeof (out.result as { body?: string }).body).toBe("string")
    expect(Buffer.byteLength((out.result as { body: string }).body, "utf8")).toBe(MAX_RESPONSE_BYTES)
  })
})

describe("claws-http overlay wiring", () => {
  it("does not put http on OUTBOUND_ACTION_DENY (class is the gate)", () => {
    expect(OUTBOUND_ACTION_DENY).not.toContain("http")
  })

  it("MUTATION: Dockerfile copies claws-http to /opt/claws-http", () => {
    const dockerfile = readFileSync(join(process.cwd(), "docker/Dockerfile"), "utf8")
    expect(dockerfile).toContain("COPY container/claws-http /opt/claws-http")
    const generator = readFileSync(join(process.cwd(), "src/lib/openclaw/generator.ts"), "utf8")
    expect(generator).toContain("'/opt/claws-http'")
    expect(generator).toMatch(/'claws-http':\s*\{\s*enabled:\s*true,?\s*\}/)
  })

  it("manifest contracts.tools includes http and configSchema is strict empty", () => {
    const manifest = JSON.parse(
      readFileSync(join(process.cwd(), "container/claws-http/openclaw.plugin.json"), "utf8"),
    ) as {
      contracts: { tools: string[] }
      configSchema: { additionalProperties: boolean; properties: Record<string, unknown> }
    }
    expect(manifest.contracts.tools).toEqual(["http"])
    expect(manifest.configSchema.additionalProperties).toBe(false)
    expect(manifest.configSchema.properties).toEqual({})
    expect(httpPlugin.HTTP_PARAMETERS.required).toEqual(["skill", "method", "url"])
  })

  it("register() exposes the http tool", async () => {
    const tools: Array<{ name: string }> = []
    const plugin = (
      await import("../../container/claws-http/index.mjs")
    ).default as {
      register: (api: { registerTool: (tool: { name: string }) => void }) => void
    }
    plugin.register({
      registerTool: (tool) => {
        tools.push(tool)
      },
    })
    expect(tools.map((t) => t.name)).toEqual(["http"])
  })
})
