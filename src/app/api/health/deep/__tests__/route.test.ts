import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"

const mockPing = vi.fn()

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))
vi.mock("@/lib/redis", () => ({
  redis: { ping: (...args: unknown[]) => mockPing(...args) },
}))

import { GET } from "@/app/api/health/deep/route"

describe("GET /api/health/deep", () => {
  const prevUrl = process.env.UPSTASH_REDIS_REST_URL
  const prevToken = process.env.UPSTASH_REDIS_REST_TOKEN
  const prevSha = process.env.VERCEL_GIT_COMMIT_SHA

  beforeEach(() => {
    ;(prismaMock.$queryRaw as ReturnType<typeof vi.fn>).mockResolvedValue([{ "?column?": 1 }])
    mockPing.mockResolvedValue("PONG")
    process.env.UPSTASH_REDIS_REST_URL = "https://example.upstash.io"
    process.env.UPSTASH_REDIS_REST_TOKEN = "test-token"
  })

  afterEach(() => {
    if (prevUrl === undefined) delete process.env.UPSTASH_REDIS_REST_URL
    else process.env.UPSTASH_REDIS_REST_URL = prevUrl
    if (prevToken === undefined) delete process.env.UPSTASH_REDIS_REST_TOKEN
    else process.env.UPSTASH_REDIS_REST_TOKEN = prevToken
    if (prevSha === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA
    else process.env.VERCEL_GIT_COMMIT_SHA = prevSha
  })

  it("returns healthy when DB and Redis ping succeed", async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = "abcdef012345"
    const res = await GET()
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.status).toBe("healthy")
    expect(json.checks).toEqual({ app: "ok", database: "ok", redis: "ok" })
    expect(json.commit).toBe("abcdef0")
    // No secrets in body
    expect(JSON.stringify(json)).not.toMatch(/UPSTASH|TOKEN|SECRET|password|redis:\/\//i)
  })

  it("returns 503 degraded when Redis ping fails", async () => {
    mockPing.mockRejectedValueOnce(new Error("redis down"))
    const res = await GET()
    const json = await res.json()
    expect(res.status).toBe(503)
    expect(json.status).toBe("degraded")
    expect(json.checks.database).toBe("ok")
    expect(json.checks.redis).toBe("error")
  })

  it("returns 503 degraded when DB fails", async () => {
    ;(prismaMock.$queryRaw as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("db down"),
    )
    const res = await GET()
    const json = await res.json()
    expect(res.status).toBe(503)
    expect(json.checks.database).toBe("error")
  })

  it("MUTATION: response must not embed redis URL/token", async () => {
    const res = await GET()
    const body = JSON.stringify(await res.json())
    expect(body).not.toContain("example.upstash.io")
    expect(body).not.toContain("test-token")
  })
})
