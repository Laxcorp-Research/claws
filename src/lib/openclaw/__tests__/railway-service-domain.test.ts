import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), deployEvent: vi.fn() },
}))

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function parseBody(call: unknown[]): { query: string; variables: Record<string, unknown> } {
  return JSON.parse((call[1] as RequestInit).body as string) as {
    query: string
    variables: Record<string, unknown>
  }
}

async function loadClient() {
  return import("@/lib/openclaw/railway-client")
}

beforeEach(() => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.stubEnv("RAILWAY_API_TOKEN", "test-token")
  vi.stubEnv("RAILWAY_PROJECT_ID", "proj-1")
  vi.stubEnv("RAILWAY_ENVIRONMENT_ID", "env-1")
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe("ensureServiceDomain", () => {
  it("reuses the preferred host and prunes extras without creating", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            domains: {
              serviceDomains: [
                {
                  id: "keep-id",
                  domain: "keep.up.railway.app",
                  createdAt: "2026-08-30T04:28:39.768Z",
                },
                {
                  id: "extra-id",
                  domain: "keep-production-abc.up.railway.app",
                  createdAt: "2026-08-31T15:31:00.000Z",
                },
              ],
            },
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: { serviceDomainDelete: true } }))
    vi.stubGlobal("fetch", fetchMock)

    const { ensureServiceDomain } = await loadClient()
    await expect(ensureServiceDomain("svc-1", "keep.up.railway.app")).resolves.toBe(
      "keep.up.railway.app",
    )

    const queries = fetchMock.mock.calls.map((call) => parseBody(call).query)
    expect(queries[0]).toContain("domains(projectId")
    expect(queries[1]).toContain("serviceDomainDelete")
    expect(queries.some((q) => q.includes("serviceDomainCreate"))).toBe(false)
    expect(parseBody(fetchMock.mock.calls[1]).variables).toEqual({ id: "extra-id" })
  })

  it("creates only when the list is empty", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { domains: { serviceDomains: [] } } }))
      .mockResolvedValueOnce(
        jsonResponse({ data: { serviceDomainCreate: { domain: "fresh.up.railway.app" } } }),
      )
    vi.stubGlobal("fetch", fetchMock)

    const { ensureServiceDomain } = await loadClient()
    await expect(ensureServiceDomain("svc-1")).resolves.toBe("fresh.up.railway.app")
    expect(parseBody(fetchMock.mock.calls[1]).query).toContain("serviceDomainCreate")
  })

  it("cap on create → prune extras → reuse keep, never throw GraphQL", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { domains: { serviceDomains: [] } } }))
      .mockResolvedValueOnce(
        jsonResponse({
          errors: [{ message: "You have reached the maximum number of domains for this service" }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            domains: {
              serviceDomains: [
                {
                  id: "keep-id",
                  domain: "keep.up.railway.app",
                  createdAt: "2026-08-30T04:28:39.768Z",
                },
                {
                  id: "extra-id",
                  domain: "extra.up.railway.app",
                  createdAt: "2026-08-31T00:00:00.000Z",
                },
              ],
            },
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: { serviceDomainDelete: true } }))
    vi.stubGlobal("fetch", fetchMock)

    const { ensureServiceDomain } = await loadClient()
    await expect(ensureServiceDomain("svc-1", "keep.up.railway.app")).resolves.toBe(
      "keep.up.railway.app",
    )
    const queries = fetchMock.mock.calls.map((call) => parseBody(call).query)
    expect(queries.filter((q) => q.includes("serviceDomainCreate"))).toHaveLength(1)
    expect(queries.some((q) => q.includes("serviceDomainDelete"))).toBe(true)
  })

  it("cap heal exhausted → RailwayDomainCapError without GraphQL text", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ data: { domains: { serviceDomains: [] } } }))
      .mockResolvedValueOnce(
        jsonResponse({
          errors: [{ message: "You have reached the maximum number of domains for this service" }],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: { domains: { serviceDomains: [] } } }))
      .mockResolvedValueOnce(
        jsonResponse({
          errors: [{ message: "You have reached the maximum number of domains for this service" }],
        }),
      )
    vi.stubGlobal("fetch", fetchMock)

    const { ensureServiceDomain } = await loadClient()
    await expect(ensureServiceDomain("svc-1")).rejects.toMatchObject({
      name: "RailwayDomainCapError",
      message: expect.not.stringContaining("GraphQL"),
    })
  })
})
