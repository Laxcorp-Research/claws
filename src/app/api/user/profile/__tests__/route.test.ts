// Account deletion is a 14-day grace. Immediate user.delete is gone:
// the retention cron tears containers down, then deletes the user.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

const mockGetSessionUser = vi.fn()
vi.mock("@/lib/api/auth", () => ({ getSessionUser: () => mockGetSessionUser() }))

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { DELETE } from "@/app/api/user/profile/route"

type MockFn = ReturnType<typeof vi.fn>

describe("DELETE /api/user/profile (14-day grace)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSessionUser.mockResolvedValue({ id: "user-del" })
    ;(prismaMock.user.findUnique as MockFn).mockResolvedValue({ deletionRequestedAt: null })
    ;(prismaMock.user.update as MockFn).mockResolvedValue({ id: "user-del" })
  })

  it("returns 401 when not authenticated", async () => {
    mockGetSessionUser.mockResolvedValue(null)
    const res = await DELETE()
    expect(res.status).toBe(401)
    expect(prismaMock.user.delete).not.toHaveBeenCalled()
    expect(prismaMock.user.update).not.toHaveBeenCalled()
  })

  it("schedules deletion and does not delete the user or tear down containers", async () => {
    const res = await DELETE()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.scheduled).toBe(true)
    expect(body.data.purgeAt).toBeTruthy()
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user-del" },
        data: expect.objectContaining({ deletionRequestedAt: expect.any(Date) }),
      }),
    )
    expect(prismaMock.user.delete).not.toHaveBeenCalled()
  })

  it("a second DELETE is idempotent and does not move the clock", async () => {
    const requested = new Date("2026-10-01T00:00:00.000Z")
    ;(prismaMock.user.findUnique as MockFn).mockResolvedValue({ deletionRequestedAt: requested })
    const res = await DELETE()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data.purgeAt).toBe("2026-10-15T00:00:00.000Z")
    expect(prismaMock.user.update).not.toHaveBeenCalled()
    expect(prismaMock.user.delete).not.toHaveBeenCalled()
  })
})
