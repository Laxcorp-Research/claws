import { normalizeHttpPath, type HttpMethod } from "@/lib/openclaw/http-contract"

export type HttpFixtureRecording = {
  skill: string
  method: HttpMethod
  /** Exact path, basename (products.json), or substring ( /variants/ ). */
  path: string
  pathMatch?: "exact" | "basename" | "includes"
  queryShape?: string
  httpStatus: number
  body: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Staging / test / preview only. Production CLAWS_ENV always wins.
 * VERCEL_ENV=production is a lock only when CLAWS_ENV is unset so a staging
 * Vercel production deploy (CLAWS_ENV=staging) can still fixture.
 */
export function isHttpFixtureRuntimeAllowed(
  env: Record<string, string | undefined> = process.env,
): boolean {
  const claws = (env.CLAWS_ENV ?? "").trim().toLowerCase()
  if (claws === "production") return false
  if (claws === "staging" || claws === "development" || claws === "test") return true
  const vercel = (env.VERCEL_ENV ?? "").trim().toLowerCase()
  if (vercel === "production") return false
  const node = (env.NODE_ENV ?? "").trim().toLowerCase()
  if (node === "test" || node === "development") return true
  if (vercel === "preview") return true
  return false
}

export function isHttpFixtureEnabled(
  workspaceFlag: boolean | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (workspaceFlag !== true) return false
  return isHttpFixtureRuntimeAllowed(env)
}

const AUTH_BODY_KEYS = new Set(["api_key", "user_id", "connected_account_id"])

export function httpQueryShape(args: { url?: string; body?: unknown }): string {
  const names = new Set<string>()
  if (typeof args.url === "string" && args.url.trim()) {
    try {
      const parsed = new URL(args.url)
      for (const key of parsed.searchParams.keys()) names.add(key)
    } catch {
      /* ignore invalid url */
    }
  }
  if (isRecord(args.body)) {
    for (const key of Object.keys(args.body)) {
      if (!AUTH_BODY_KEYS.has(key)) names.add(key)
    }
  }
  return [...names].sort().join(",")
}

function basename(path: string): string {
  const parts = normalizeHttpPath(path).split("/")
  return parts[parts.length - 1] ?? ""
}

function fixturePathMatches(callPath: string, recording: HttpFixtureRecording): boolean {
  const call = normalizeHttpPath(callPath)
  const rec = normalizeHttpPath(recording.path)
  if (call === rec) return true
  if (recording.pathMatch === "basename") {
    const callBase = basename(call)
    const recBase = basename(rec)
    return callBase.length > 0 && callBase === recBase
  }
  if (recording.pathMatch === "includes") {
    return rec.length > 0 && call.includes(rec)
  }
  return call.endsWith(rec) || call.endsWith(`/${rec.replace(/^\//, "")}`)
}

export const HTTP_FIXTURE_RECORDINGS: readonly HttpFixtureRecording[] = [
  {
    skill: "tavily-search",
    method: "POST",
    path: "/search",
    httpStatus: 200,
    body: {
      query: "micron earnings",
      results: [
        {
          title: "Micron reports fiscal Q4 results",
          url: "https://investors.micron.com/fixture",
          content: "Revenue and guidance as recorded in the fixture set.",
          score: 0.91,
        },
      ],
    },
  },
  {
    skill: "tavily-search",
    method: "POST",
    path: "/extract",
    httpStatus: 200,
    body: {
      results: [{ url: "https://investors.micron.com/fixture", raw_content: "Extracted filing text (fixture)." }],
    },
  },
  {
    skill: "twitter-api",
    method: "GET",
    path: "/2/tweets/search/recent",
    queryShape: "query",
    httpStatus: 200,
    body: {
      data: [{ id: "1960000000000000001", text: "Fixture tweet: merino restock chatter" }],
      meta: { result_count: 1 },
    },
  },
  {
    skill: "twitter-api",
    method: "GET",
    path: "/2/tweets/search/recent",
    httpStatus: 200,
    body: {
      data: [{ id: "1960000000000000001", text: "Fixture tweet: merino restock chatter" }],
      meta: { result_count: 1 },
    },
  },
  {
    skill: "alpaca-trading",
    method: "GET",
    path: "/v2/account",
    httpStatus: 200,
    body: {
      id: "fixture-paper-account",
      status: "ACTIVE",
      currency: "USD",
      cash: "100000",
      equity: "100000",
      buying_power: "200000",
      pattern_day_trader: false,
    },
  },
  {
    skill: "alpaca-trading",
    method: "GET",
    path: "/v2/positions",
    httpStatus: 200,
    body: [],
  },
  {
    skill: "alpaca-trading",
    method: "GET",
    path: "/v2/clock",
    httpStatus: 200,
    body: {
      timestamp: "2026-09-08T13:30:00-04:00",
      is_open: true,
      next_open: "2026-09-09T09:30:00-04:00",
      next_close: "2026-09-08T16:00:00-04:00",
    },
  },
  {
    skill: "shopify-store",
    method: "GET",
    path: "/admin/api/2024-10/products.json",
    pathMatch: "basename",
    httpStatus: 200,
    body: {
      products: [
        {
          id: 8010000000001,
          title: "Merino Crew Tee",
          status: "active",
          variants: [
            {
              id: 9010000000001,
              sku: "TEE-NAVY",
              price: "48.00",
              inventory_quantity: 42,
              inventory_item_id: 7010000000001,
            },
          ],
        },
        {
          id: 8010000000002,
          title: "Canvas Tote",
          status: "active",
          variants: [
            {
              id: 9010000000002,
              sku: "TOTE-NAT",
              price: "28.00",
              inventory_quantity: 18,
              inventory_item_id: 7010000000002,
            },
          ],
        },
      ],
    },
  },
  {
    skill: "shopify-store",
    method: "GET",
    path: "/admin/api/2024-10/inventory_levels.json",
    pathMatch: "basename",
    httpStatus: 200,
    body: {
      inventory_levels: [
        { inventory_item_id: 7010000000001, location_id: 1, available: 42 },
        { inventory_item_id: 7010000000002, location_id: 1, available: 18 },
      ],
    },
  },
  {
    skill: "shopify-store",
    method: "GET",
    path: "/admin/api/2024-10/orders.json",
    pathMatch: "basename",
    httpStatus: 200,
    body: {
      orders: [
        {
          id: 5010000000001,
          name: "#1001",
          financial_status: "paid",
          total_price: "96.00",
          line_items: [{ sku: "TEE-NAVY", quantity: 2, price: "48.00" }],
        },
        {
          id: 5010000000002,
          name: "#1002",
          financial_status: "paid",
          total_price: "28.00",
          line_items: [{ sku: "TOTE-NAT", quantity: 1, price: "28.00" }],
        },
      ],
    },
  },
  {
    skill: "shopify-store",
    method: "PUT",
    path: "/variants/",
    pathMatch: "includes",
    httpStatus: 200,
    body: {
      variant: { id: 9010000000001, sku: "TEE-NAVY", price: "52.00" },
    },
  },
  {
    skill: "gmail-ops",
    method: "POST",
    path: "/api/v3/tools/execute/GMAIL_FETCH_EMAILS",
    httpStatus: 200,
    body: {
      successful: true,
      data: {
        messages: [
          {
            id: "fixture-msg-1",
            threadId: "fixture-thread-1",
            snippet: "Your order #1001 has shipped",
            labelIds: ["INBOX"],
          },
        ],
      },
    },
  },
  {
    skill: "hubspot-crm",
    method: "POST",
    path: "/api/v3/tools/execute/HUBSPOT_HUBSPOT_LIST_CONTACTS",
    httpStatus: 200,
    body: {
      successful: true,
      data: {
        results: [{ id: "1", properties: { email: "ada@example.com", firstname: "Ada" } }],
      },
    },
  },
]

export function lookupHttpFixture(args: {
  skill: string
  method: string
  path: string
  url?: string
  body?: unknown
}): HttpFixtureRecording | null {
  const method = args.method.trim().toUpperCase() as HttpMethod
  const shape = httpQueryShape({ url: args.url, body: args.body })
  const exactShape: HttpFixtureRecording[] = []
  const anyShape: HttpFixtureRecording[] = []
  for (const recording of HTTP_FIXTURE_RECORDINGS) {
    if (recording.skill !== args.skill) continue
    if (recording.method !== method) continue
    if (!fixturePathMatches(args.path, recording)) continue
    if (recording.queryShape != null) {
      if (recording.queryShape === shape) exactShape.push(recording)
    } else {
      anyShape.push(recording)
    }
  }
  return exactShape[0] ?? anyShape[0] ?? null
}

export function serializeHttpFixtureBody(body: unknown): string {
  if (typeof body === "string") return body
  return JSON.stringify(body)
}
