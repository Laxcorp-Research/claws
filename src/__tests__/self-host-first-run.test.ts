import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("next-auth/jwt", () => ({
  getToken: vi.fn().mockResolvedValue(null),
}))

vi.mock("@/lib/rate-limit", () => ({
  apiRateLimit: { limit: vi.fn().mockResolvedValue({ success: true, remaining: 99, reset: Date.now() + 60000 }) },
  authRateLimit: { limit: vi.fn().mockResolvedValue({ success: true, remaining: 9, reset: Date.now() + 60000 }) },
}))

vi.mock("@/lib/auth/owner-gate", () => ({
  selfHostNeedsOwner: vi.fn().mockResolvedValue(true),
}))

import { proxy } from "@/proxy"
import {
  CREDENTIAL_WINDOW_MS,
  consumeCredentialAttempt,
  credentialRejectionStatus,
  resetCredentialLockout,
} from "@/lib/auth/credential-lockout"

describe("self-host boot with no owner", () => {
  beforeEach(() => {
    process.env.CLAWS_PROFILE = "self-host"
  })

  afterEach(() => {
    delete process.env.CLAWS_PROFILE
  })

  it("redirects /store to /setup/owner", async () => {
    const res = await proxy(new NextRequest("http://localhost:3000/store"))
    expect(res.status).toBe(307)
    expect(res.headers.get("location")).toBe("http://localhost:3000/setup/owner")
  })

  it("leaves /api/health and /setup/owner reachable", async () => {
    const health = await proxy(new NextRequest("http://localhost:3000/api/health"))
    expect(health.status).not.toBe(307)
    const owner = await proxy(new NextRequest("http://localhost:3000/setup/owner"))
    expect(owner.headers.get("location")).toBeNull()
  })
})

describe("owner credential lockout", () => {
  beforeEach(() => {
    resetCredentialLockout()
    delete process.env.UPSTASH_REDIS_REST_URL
    delete process.env.UPSTASH_REDIS_REST_TOKEN
  })

  it("locks out after 5 attempts for 15 minutes", async () => {
    const ip = "203.0.113.9"
    const start = 1_700_000_000_000
    for (let attempt = 0; attempt < 5; attempt++) {
      expect(await consumeCredentialAttempt(ip, start)).toBe("ok")
      expect(credentialRejectionStatus("ok")).toBe(401)
    }
    expect(await consumeCredentialAttempt(ip, start + 1_000)).toBe("locked")
    expect(credentialRejectionStatus("locked")).toBe(429)
    expect(await consumeCredentialAttempt(ip, start + CREDENTIAL_WINDOW_MS + 1)).toBe("ok")

    resetCredentialLockout()
    for (let attempt = 0; attempt < 5; attempt++) {
      expect(await consumeCredentialAttempt(ip)).toBe("ok")
    }
    const res = await proxy(
      new NextRequest("http://localhost:3000/api/auth/callback/credentials", {
        method: "POST",
        headers: { "x-forwarded-for": ip },
      }),
    )
    expect(res.status).toBe(429)
  })
})
