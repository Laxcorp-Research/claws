import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@/lib/logger", () => ({
  log: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}))

import {
  validateToolKey,
  hasValidator,
  IMPLEMENTED_SLUGS,
} from "@/lib/tools/validators"

function mockFetchOnce(init: {
  status?: number
  ok?: boolean
  json?: unknown
}) {
  const status = init.status ?? 200
  const response = {
    status,
    ok: init.ok ?? (status >= 200 && status < 300),
    json: vi.fn().mockResolvedValue(init.json ?? {}),
  }
  global.fetch = vi.fn().mockResolvedValue(response) as unknown as typeof fetch
  return response
}

function mockFetchThrows(err: unknown) {
  global.fetch = vi.fn().mockRejectedValue(err) as unknown as typeof fetch
}

const ORIGINAL_FETCH = global.fetch

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  global.fetch = ORIGINAL_FETCH
})

describe("validateToolKey dispatch", () => {
  it("rejects empty credentials before touching any validator", async () => {
    const result = await validateToolKey("anthropic_api", {})
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/empty/i)
  })

  it("rejects credentials with only whitespace values", async () => {
    const result = await validateToolKey("tavily", { TAVILY_API_KEY: "   " })
    expect(result.valid).toBe(false)
  })

  it("returns unverified passthrough for unknown tool slug", async () => {
    const result = await validateToolKey("unknown-tool-slug", { FOO: "bar" })
    expect(result.valid).toBe(true)
    expect(result.unverified).toBe(true)
    expect(result.message).toMatch(/not verified/i)
  })

  it("returns a connection error when fetch throws for a known tool", async () => {
    mockFetchThrows(new TypeError("fetch failed"))
    const result = await validateToolKey("anthropic_api", {
      ANTHROPIC_API_KEY: "sk-ant-fake",
    })
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/unable to validate|connection/i)
  })

  it("returns a timeout-specific error when fetch aborts", async () => {
    const err = new Error("operation was aborted")
    err.name = "TimeoutError"
    mockFetchThrows(err)
    const result = await validateToolKey("anthropic_api", {
      ANTHROPIC_API_KEY: "sk-ant-fake",
    })
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/didn't respond/i)
  })
})

describe("IMPLEMENTED_SLUGS", () => {
  it("contains all 12 confident validators after PR #2", () => {
    expect([...IMPLEMENTED_SLUGS].sort()).toEqual(
      [
        "alpaca",
        "anthropic_api",
        "beehiiv-api",
        "binance",
        "brave_search",
        "coinbase",
        "elevenlabs",
        "salesforce-api",
        "sendgrid",
        "stripe_api",
        "tavily",
        "youtube-data-api",
      ].sort(),
    )
  })

  it("hasValidator reflects the registry", () => {
    expect(hasValidator("stripe_api")).toBe(true)
    expect(hasValidator("binance")).toBe(true)
    expect(hasValidator("twilio")).toBe(false)
  })
})

// ─── Per-validator behavior (existing 7) ───────────────

describe("anthropic_api validator", () => {
  const creds = { ANTHROPIC_API_KEY: "sk-ant-test" }

  it("returns valid on 2xx", async () => {
    mockFetchOnce({ status: 200 })
    const result = await validateToolKey("anthropic_api", creds)
    expect(result.valid).toBe(true)
  })

  it("returns invalid on 401", async () => {
    mockFetchOnce({ status: 401 })
    const result = await validateToolKey("anthropic_api", creds)
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/Anthropic/)
  })

  it("treats 429 as valid (rate limited = key works)", async () => {
    mockFetchOnce({ status: 429 })
    const result = await validateToolKey("anthropic_api", creds)
    expect(result.valid).toBe(true)
  })

  it("returns warning on 5xx (provider down)", async () => {
    mockFetchOnce({ status: 503 })
    const result = await validateToolKey("anthropic_api", creds)
    expect(result.valid).toBe(true)
    expect(result.warning).toMatch(/couldn't verify/i)
  })

  it("accepts 400 invalid_request_error as valid (key authenticated but request shape was bad)", async () => {
    mockFetchOnce({
      status: 400,
      json: { error: { type: "invalid_request_error" } },
    })
    const result = await validateToolKey("anthropic_api", creds)
    expect(result.valid).toBe(true)
  })

  it("rejects missing required envVar", async () => {
    const result = await validateToolKey("anthropic_api", { WRONG_KEY: "x" })
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/missing required.*ANTHROPIC_API_KEY/i)
  })
})

describe("tavily validator", () => {
  it("returns valid on 200", async () => {
    mockFetchOnce({ status: 200 })
    const result = await validateToolKey("tavily", { TAVILY_API_KEY: "tvly-test" })
    expect(result.valid).toBe(true)
  })

  it("returns invalid on 401", async () => {
    mockFetchOnce({ status: 401 })
    const result = await validateToolKey("tavily", { TAVILY_API_KEY: "tvly-test" })
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/Tavily/)
  })

  it("passes api_key in the request body", async () => {
    mockFetchOnce({ status: 200 })
    await validateToolKey("tavily", { TAVILY_API_KEY: "tvly-abc" })
    expect(global.fetch).toHaveBeenCalledTimes(1)
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(String(url)).toContain("api.tavily.com")
    expect(init?.method).toBe("POST")
    const body = JSON.parse(String(init?.body))
    expect(body.api_key).toBe("tvly-abc")
  })
})

describe("stripe_api validator", () => {
  it("returns valid on 200", async () => {
    mockFetchOnce({ status: 200 })
    const result = await validateToolKey("stripe_api", { STRIPE_API_KEY: "sk_live_test" })
    expect(result.valid).toBe(true)
  })

  it("returns invalid on 401", async () => {
    mockFetchOnce({ status: 401 })
    const result = await validateToolKey("stripe_api", { STRIPE_API_KEY: "sk_live_test" })
    expect(result.valid).toBe(false)
  })

  it("sends the key as a Bearer token", async () => {
    mockFetchOnce({ status: 200 })
    await validateToolKey("stripe_api", { STRIPE_API_KEY: "sk_test_fixture" })
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const headers = init?.headers as Record<string, string>
    expect(headers.Authorization).toBe("Bearer sk_test_fixture")
  })
})

describe("sendgrid validator", () => {
  it("returns valid on 200", async () => {
    mockFetchOnce({ status: 200 })
    const result = await validateToolKey("sendgrid", { SENDGRID_API_KEY: "SG.test" })
    expect(result.valid).toBe(true)
  })

  it("returns invalid on 403", async () => {
    mockFetchOnce({ status: 403 })
    const result = await validateToolKey("sendgrid", { SENDGRID_API_KEY: "SG.test" })
    expect(result.valid).toBe(false)
  })

  it("returns warning on 502", async () => {
    mockFetchOnce({ status: 502 })
    const result = await validateToolKey("sendgrid", { SENDGRID_API_KEY: "SG.test" })
    expect(result.valid).toBe(true)
    expect(result.warning).toBeDefined()
  })
})

describe("elevenlabs validator", () => {
  it("returns valid on 200", async () => {
    mockFetchOnce({ status: 200 })
    const result = await validateToolKey("elevenlabs", { ELEVENLABS_API_KEY: "xi-test" })
    expect(result.valid).toBe(true)
  })

  it("sends the key in xi-api-key header", async () => {
    mockFetchOnce({ status: 200 })
    await validateToolKey("elevenlabs", { ELEVENLABS_API_KEY: "xi-abc" })
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const headers = init?.headers as Record<string, string>
    expect(headers["xi-api-key"]).toBe("xi-abc")
  })

  it("returns invalid on 401", async () => {
    mockFetchOnce({ status: 401 })
    const result = await validateToolKey("elevenlabs", { ELEVENLABS_API_KEY: "xi-test" })
    expect(result.valid).toBe(false)
  })
})

describe("brave_search validator", () => {
  const creds = { BRAVE_SEARCH_API_KEY: "brave-key" }

  it("returns valid on 200", async () => {
    mockFetchOnce({ status: 200 })
    const result = await validateToolKey("brave_search", creds)
    expect(result.valid).toBe(true)
  })

  it("returns invalid on 401", async () => {
    mockFetchOnce({ status: 401 })
    const result = await validateToolKey("brave_search", creds)
    expect(result.valid).toBe(false)
  })

  it("returns invalid on 422 (Brave's 'missing/bad token' status)", async () => {
    mockFetchOnce({ status: 422 })
    const result = await validateToolKey("brave_search", creds)
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/Brave/)
  })

  it("sends the subscription token header", async () => {
    mockFetchOnce({ status: 200 })
    await validateToolKey("brave_search", { BRAVE_SEARCH_API_KEY: "brave-xyz" })
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const headers = init?.headers as Record<string, string>
    expect(headers["X-Subscription-Token"]).toBe("brave-xyz")
  })
})

describe("youtube-data-api validator", () => {
  const creds = { YOUTUBE_DATA_API_KEY: "AIzaTest" }

  it("returns valid on 200", async () => {
    mockFetchOnce({ status: 200 })
    const result = await validateToolKey("youtube-data-api", creds)
    expect(result.valid).toBe(true)
  })

  it("returns invalid on 400 with keyInvalid reason", async () => {
    mockFetchOnce({
      status: 400,
      json: { error: { errors: [{ reason: "keyInvalid" }] } },
    })
    const result = await validateToolKey("youtube-data-api", creds)
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/Invalid YouTube/)
  })

  it("returns a helpful error on 403 accessNotConfigured", async () => {
    mockFetchOnce({
      status: 403,
      json: { error: { errors: [{ reason: "accessNotConfigured" }] } },
    })
    const result = await validateToolKey("youtube-data-api", creds)
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/not enabled/i)
  })

  it("returns warning on 500", async () => {
    mockFetchOnce({ status: 500 })
    const result = await validateToolKey("youtube-data-api", creds)
    expect(result.valid).toBe(true)
    expect(result.warning).toBeDefined()
  })

  it("URL-encodes the api key so keys with special chars don't break the URL", async () => {
    mockFetchOnce({ status: 200 })
    await validateToolKey("youtube-data-api", { YOUTUBE_DATA_API_KEY: "a&b=c" })
    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(String(url)).toContain("a%26b%3Dc")
  })
})

// ─── Per-validator behavior (5 new multi-cred in PR #2) ─

describe("binance validator (multi-cred)", () => {
  const creds = {
    BINANCE_API_KEY: "binance-key",
    BINANCE_API_SECRET: "binance-secret",
  }

  it("returns valid on 200", async () => {
    mockFetchOnce({ status: 200 })
    const result = await validateToolKey("binance", creds)
    expect(result.valid).toBe(true)
  })

  it("returns invalid on 401", async () => {
    mockFetchOnce({ status: 401 })
    const result = await validateToolKey("binance", creds)
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/Binance/)
  })

  it("rejects when only API_KEY provided (secret missing)", async () => {
    const result = await validateToolKey("binance", { BINANCE_API_KEY: "only-key" })
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/missing.*BINANCE_API_SECRET/i)
  })

  it("rejects when only SECRET provided (key missing)", async () => {
    const result = await validateToolKey("binance", { BINANCE_API_SECRET: "only-secret" })
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/missing.*BINANCE_API_KEY/i)
  })

  it("sends the API key in X-MBX-APIKEY header and includes a signature query param", async () => {
    mockFetchOnce({ status: 200 })
    await validateToolKey("binance", creds)
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const headers = init?.headers as Record<string, string>
    expect(headers["X-MBX-APIKEY"]).toBe("binance-key")
    expect(String(url)).toMatch(/signature=[0-9a-f]{64}/) // sha256 hex
    expect(String(url)).toContain("timestamp=")
  })

  it("surfaces Binance's 400 msg to the caller", async () => {
    mockFetchOnce({ status: 400, json: { msg: "Signature for this request is not valid.", code: -1022 } })
    const result = await validateToolKey("binance", creds)
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/Signature/i)
  })
})

describe("alpaca validator (multi-cred)", () => {
  const creds = {
    ALPACA_API_KEY_ID: "PK-key",
    ALPACA_API_SECRET_KEY: "alpaca-secret",
  }

  it("returns valid on 200", async () => {
    mockFetchOnce({ status: 200 })
    const result = await validateToolKey("alpaca", creds)
    expect(result.valid).toBe(true)
  })

  it("returns invalid on 401", async () => {
    mockFetchOnce({ status: 401 })
    const result = await validateToolKey("alpaca", creds)
    expect(result.valid).toBe(false)
  })

  it("rejects when either field missing", async () => {
    const r1 = await validateToolKey("alpaca", { ALPACA_API_KEY_ID: "only-id" })
    expect(r1.valid).toBe(false)
    const r2 = await validateToolKey("alpaca", { ALPACA_API_SECRET_KEY: "only-secret" })
    expect(r2.valid).toBe(false)
  })

  it("sends both headers", async () => {
    mockFetchOnce({ status: 200 })
    await validateToolKey("alpaca", creds)
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const headers = init?.headers as Record<string, string>
    expect(String(url)).toContain("api.alpaca.markets")
    expect(headers["APCA-API-KEY-ID"]).toBe("PK-key")
    expect(headers["APCA-API-SECRET-KEY"]).toBe("alpaca-secret")
  })
})

describe("coinbase validator (multi-cred with passphrase)", () => {
  const creds = {
    COINBASE_API_KEY: "cb-key",
    // Base64 decode of "coinbase-secret-bytes" (placeholder — real secret
    // must be base64-decodable for HMAC). Using an arbitrary valid base64.
    COINBASE_API_SECRET: Buffer.from("coinbase-raw-secret").toString("base64"),
    COINBASE_API_PASSPHRASE: "passphrase",
  }

  it("returns valid on 200", async () => {
    mockFetchOnce({ status: 200 })
    const result = await validateToolKey("coinbase", creds)
    expect(result.valid).toBe(true)
  })

  it("returns invalid on 401", async () => {
    mockFetchOnce({ status: 401 })
    const result = await validateToolKey("coinbase", creds)
    expect(result.valid).toBe(false)
  })

  it("rejects when any of the 3 fields missing", async () => {
    const r1 = await validateToolKey("coinbase", {
      COINBASE_API_KEY: "k",
      COINBASE_API_SECRET: creds.COINBASE_API_SECRET,
    })
    expect(r1.valid).toBe(false)
    expect(r1.error).toMatch(/COINBASE_API_PASSPHRASE/i)
  })

  it("sends all 4 CB-ACCESS-* headers", async () => {
    mockFetchOnce({ status: 200 })
    await validateToolKey("coinbase", creds)
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const headers = init?.headers as Record<string, string>
    expect(headers["CB-ACCESS-KEY"]).toBe("cb-key")
    expect(headers["CB-ACCESS-PASSPHRASE"]).toBe("passphrase")
    expect(headers["CB-ACCESS-TIMESTAMP"]).toMatch(/^\d+$/)
    expect(headers["CB-ACCESS-SIGN"]).toBeDefined() // base64 HMAC
  })
})

describe("salesforce-api validator (multi-cred)", () => {
  const validCreds = {
    SALESFORCE_INSTANCE_URL: "https://mydomain.my.salesforce.com",
    SALESFORCE_ACCESS_TOKEN: "00D-token",
  }

  it("returns valid on 200", async () => {
    mockFetchOnce({ status: 200 })
    const result = await validateToolKey("salesforce-api", validCreds)
    expect(result.valid).toBe(true)
  })

  it("returns invalid on 401", async () => {
    mockFetchOnce({ status: 401 })
    const result = await validateToolKey("salesforce-api", validCreds)
    expect(result.valid).toBe(false)
  })

  it("rejects a malformed instance URL before hitting the network", async () => {
    const badUrl = {
      SALESFORCE_INSTANCE_URL: "http://not-salesforce.example.com",
      SALESFORCE_ACCESS_TOKEN: "token",
    }
    const fetchMock = vi.fn()
    global.fetch = fetchMock as unknown as typeof fetch
    const result = await validateToolKey("salesforce-api", badUrl)
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/salesforce\.com/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("accepts the non-`.my.` form too", async () => {
    mockFetchOnce({ status: 200 })
    const result = await validateToolKey("salesforce-api", {
      SALESFORCE_INSTANCE_URL: "https://na1.salesforce.com",
      SALESFORCE_ACCESS_TOKEN: "token",
    })
    expect(result.valid).toBe(true)
  })

  it("sends Bearer token", async () => {
    mockFetchOnce({ status: 200 })
    await validateToolKey("salesforce-api", validCreds)
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const headers = init?.headers as Record<string, string>
    expect(String(url)).toContain("mydomain.my.salesforce.com/services/data/v59.0/")
    expect(headers.Authorization).toBe("Bearer 00D-token")
  })
})

describe("beehiiv-api validator (multi-cred)", () => {
  const creds = {
    BEEHIIV_PUBLICATION_ID: "pub_abcd-1234",
    BEEHIIV_API_KEY: "bh-key",
  }

  it("returns valid on 200", async () => {
    mockFetchOnce({ status: 200 })
    const result = await validateToolKey("beehiiv-api", creds)
    expect(result.valid).toBe(true)
  })

  it("returns invalid on 401", async () => {
    mockFetchOnce({ status: 401 })
    const result = await validateToolKey("beehiiv-api", creds)
    expect(result.valid).toBe(false)
  })

  it("returns helpful error on 404 (pub not found)", async () => {
    mockFetchOnce({ status: 404 })
    const result = await validateToolKey("beehiiv-api", creds)
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/publication not found/i)
  })

  it("URL-encodes publication id", async () => {
    mockFetchOnce({ status: 200 })
    await validateToolKey("beehiiv-api", {
      BEEHIIV_PUBLICATION_ID: "pub with/slash",
      BEEHIIV_API_KEY: "bh-key",
    })
    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(String(url)).toContain("pub%20with%2Fslash")
  })

  it("rejects when either field missing", async () => {
    const r1 = await validateToolKey("beehiiv-api", { BEEHIIV_API_KEY: "k" })
    expect(r1.valid).toBe(false)
    expect(r1.error).toMatch(/BEEHIIV_PUBLICATION_ID/i)
  })
})
