import { describe, it, expect, vi, beforeEach } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { createMockRequest, parseResponse } from "@/test/helpers/mock-request"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

vi.mock("@/lib/api/auth", () => ({
  getSessionUser: vi.fn().mockResolvedValue({
    id: "user-1",
    email: "test@example.com",
  }),
}))

vi.mock("next-auth/jwt", () => ({
  getToken: vi.fn().mockResolvedValue({
    sub: "user-1",
    email: "test@example.com",
    onboardingCompleted: false,
  }),
  encode: vi.fn().mockResolvedValue("new.jwt.token"),
}))

import { POST } from "@/app/api/user/complete-onboarding/route"
import { getSessionUser } from "@/lib/api/auth"
import { encode } from "next-auth/jwt"

describe("POST /api/user/complete-onboarding", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXTAUTH_SECRET = "test-secret"
    process.env.NEXTAUTH_URL = "http://localhost:3000"
    ;(prismaMock.user.update as ReturnType<typeof vi.fn>).mockResolvedValue({})
  })

  it("returns 401 when not authenticated", async () => {
    ;(getSessionUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)
    const req = createMockRequest("http://localhost:3000/api/user/complete-onboarding", {
      method: "POST",
    })
    const res = await POST(req)
    expect(res.status).toBe(401)
  })

  it("sets DB flag and re-encodes JWT with onboardingCompleted true", async () => {
    const req = createMockRequest("http://localhost:3000/api/user/complete-onboarding", {
      method: "POST",
    })
    const res = await POST(req)
    const { status, data } = await parseResponse(res)

    expect(status).toBe(200)
    expect(data.data.onboardingCompleted).toBe(true)
    expect(data.data.cookieRefreshed).toBe(true)
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { onboardingCompleted: true },
    })
    expect(encode).toHaveBeenCalledWith(
      expect.objectContaining({
        token: expect.objectContaining({ onboardingCompleted: true, sub: "user-1" }),
      }),
    )
    const setCookie = res.headers.get("set-cookie") ?? ""
    expect(setCookie).toMatch(/next-auth\.session-token/)
  })
})
