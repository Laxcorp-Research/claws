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
  it("rejects empty api key before touching any validator", async () => {
    const result = await validateToolKey("anthropic_api", "")
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/empty/i)
  })

  it("rejects whitespace-only api key", async () => {
    const result = await validateToolKey("tavily", "   ")
    expect(result.valid).toBe(false)
  })

  it("returns unverified passthrough for unknown tool slug", async () => {
    const result = await validateToolKey("unknown-tool-slug", "some-key")
    expect(result.valid).toBe(true)
    expect(result.unverified).toBe(true)
    expect(result.message).toMatch(/not verified/i)
  })

  it("returns a connection error when fetch throws for a known tool", async () => {
    mockFetchThrows(new TypeError("fetch failed"))
    const result = await validateToolKey("anthropic_api", "sk-ant-fake")
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/unable to validate|connection/i)
  })

  it("returns a timeout-specific error when fetch aborts", async () => {
    const err = new Error("operation was aborted")
    err.name = "TimeoutError"
    mockFetchThrows(err)
    const result = await validateToolKey("anthropic_api", "sk-ant-fake")
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/didn't respond/i)
  })
})

describe("IMPLEMENTED_SLUGS", () => {
  it("contains the 7 confident validators", () => {
    expect([...IMPLEMENTED_SLUGS].sort()).toEqual(
      [
        "anthropic_api",
        "brave_search",
        "elevenlabs",
        "sendgrid",
        "stripe_api",
        "tavily",
        "youtube-data-api",
      ].sort(),
    )
  })

  it("hasValidator reflects the registry", () => {
    expect(hasValidator("stripe_api")).toBe(true)
    expect(hasValidator("twilio")).toBe(false)
  })
})

// ─── Per-validator behavior ───────────────────────────

describe("anthropic_api validator", () => {
  it("returns valid on 2xx", async () => {
    mockFetchOnce({ status: 200 })
    const result = await validateToolKey("anthropic_api", "sk-ant-test")
    expect(result.valid).toBe(true)
  })

  it("returns invalid on 401", async () => {
    mockFetchOnce({ status: 401 })
    const result = await validateToolKey("anthropic_api", "sk-ant-test")
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/Anthropic/)
  })

  it("treats 429 as valid (rate limited = key works)", async () => {
    mockFetchOnce({ status: 429 })
    const result = await validateToolKey("anthropic_api", "sk-ant-test")
    expect(result.valid).toBe(true)
  })

  it("returns warning on 5xx (provider down)", async () => {
    mockFetchOnce({ status: 503 })
    const result = await validateToolKey("anthropic_api", "sk-ant-test")
    expect(result.valid).toBe(true)
    expect(result.warning).toMatch(/couldn't verify/i)
  })

  it("accepts 400 invalid_request_error as valid (key authenticated but request shape was bad)", async () => {
    mockFetchOnce({
      status: 400,
      json: { error: { type: "invalid_request_error" } },
    })
    const result = await validateToolKey("anthropic_api", "sk-ant-test")
    expect(result.valid).toBe(true)
  })
})

describe("tavily validator", () => {
  it("returns valid on 200", async () => {
    mockFetchOnce({ status: 200 })
    const result = await validateToolKey("tavily", "tvly-test")
    expect(result.valid).toBe(true)
  })

  it("returns invalid on 401", async () => {
    mockFetchOnce({ status: 401 })
    const result = await validateToolKey("tavily", "tvly-test")
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/Tavily/)
  })

  it("passes api_key in the request body", async () => {
    mockFetchOnce({ status: 200 })
    await validateToolKey("tavily", "tvly-abc")
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
    const result = await validateToolKey("stripe_api", "sk_live_test")
    expect(result.valid).toBe(true)
  })

  it("returns invalid on 401", async () => {
    mockFetchOnce({ status: 401 })
    const result = await validateToolKey("stripe_api", "sk_live_test")
    expect(result.valid).toBe(false)
  })

  it("sends the key as a Bearer token", async () => {
    mockFetchOnce({ status: 200 })
    await validateToolKey("stripe_api", "sk_test_fixture")
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const headers = init?.headers as Record<string, string>
    expect(headers.Authorization).toBe("Bearer sk_test_fixture")
  })
})

describe("sendgrid validator", () => {
  it("returns valid on 200", async () => {
    mockFetchOnce({ status: 200 })
    const result = await validateToolKey("sendgrid", "SG.test")
    expect(result.valid).toBe(true)
  })

  it("returns invalid on 403", async () => {
    mockFetchOnce({ status: 403 })
    const result = await validateToolKey("sendgrid", "SG.test")
    expect(result.valid).toBe(false)
  })

  it("returns warning on 502", async () => {
    mockFetchOnce({ status: 502 })
    const result = await validateToolKey("sendgrid", "SG.test")
    expect(result.valid).toBe(true)
    expect(result.warning).toBeDefined()
  })
})

describe("elevenlabs validator", () => {
  it("returns valid on 200", async () => {
    mockFetchOnce({ status: 200 })
    const result = await validateToolKey("elevenlabs", "xi-test")
    expect(result.valid).toBe(true)
  })

  it("sends the key in xi-api-key header", async () => {
    mockFetchOnce({ status: 200 })
    await validateToolKey("elevenlabs", "xi-abc")
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const headers = init?.headers as Record<string, string>
    expect(headers["xi-api-key"]).toBe("xi-abc")
  })

  it("returns invalid on 401", async () => {
    mockFetchOnce({ status: 401 })
    const result = await validateToolKey("elevenlabs", "xi-test")
    expect(result.valid).toBe(false)
  })
})

describe("brave_search validator", () => {
  it("returns valid on 200", async () => {
    mockFetchOnce({ status: 200 })
    const result = await validateToolKey("brave_search", "brave-key")
    expect(result.valid).toBe(true)
  })

  it("returns invalid on 401", async () => {
    mockFetchOnce({ status: 401 })
    const result = await validateToolKey("brave_search", "brave-key")
    expect(result.valid).toBe(false)
  })

  it("returns invalid on 422 (Brave's 'missing/bad token' status)", async () => {
    mockFetchOnce({ status: 422 })
    const result = await validateToolKey("brave_search", "brave-key")
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/Brave/)
  })

  it("sends the subscription token header", async () => {
    mockFetchOnce({ status: 200 })
    await validateToolKey("brave_search", "brave-xyz")
    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    const headers = init?.headers as Record<string, string>
    expect(headers["X-Subscription-Token"]).toBe("brave-xyz")
  })
})

describe("youtube-data-api validator", () => {
  it("returns valid on 200", async () => {
    mockFetchOnce({ status: 200 })
    const result = await validateToolKey("youtube-data-api", "AIzaTest")
    expect(result.valid).toBe(true)
  })

  it("returns invalid on 400 with keyInvalid reason", async () => {
    mockFetchOnce({
      status: 400,
      json: { error: { errors: [{ reason: "keyInvalid" }] } },
    })
    const result = await validateToolKey("youtube-data-api", "AIzaTest")
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/Invalid YouTube/)
  })

  it("returns a helpful error on 403 accessNotConfigured", async () => {
    mockFetchOnce({
      status: 403,
      json: { error: { errors: [{ reason: "accessNotConfigured" }] } },
    })
    const result = await validateToolKey("youtube-data-api", "AIzaTest")
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/not enabled/i)
  })

  it("returns warning on 500", async () => {
    mockFetchOnce({ status: 500 })
    const result = await validateToolKey("youtube-data-api", "AIzaTest")
    expect(result.valid).toBe(true)
    expect(result.warning).toBeDefined()
  })

  it("URL-encodes the api key so keys with special chars don't break the URL", async () => {
    mockFetchOnce({ status: 200 })
    await validateToolKey("youtube-data-api", "a&b=c")
    const [url] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(String(url)).toContain("a%26b%3Dc")
  })
})
