// Account deletion: containers MUST be torn down BEFORE the user row
// cascades away. The prior bare user.delete orphaned LIVE Railway services
// (Workspace rows gone -> no cron could ever reach them; user keys aboard,
// billing forever). MUTATION: remove the teardown loop -> orphan test fails.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

const mockGetSessionUser = vi.fn()
vi.mock("@/lib/api/auth", () => ({ getSessionUser: () => mockGetSessionUser() }))

const mockDestroyContainer = vi.fn()
vi.mock("@/lib/openclaw/deployer", () => ({
  destroyContainer: (...args: unknown[]) => mockDestroyContainer(...args),
}))

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import { DELETE } from "@/app/api/user/profile/route"

type MockFn = ReturnType<typeof vi.fn>

describe("DELETE /api/user/profile (account deletion)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSessionUser.mockResolvedValue({ id: "user-del" })
    mockDestroyContainer.mockResolvedValue(undefined)
    ;(prismaMock.user.delete as MockFn).mockResolvedValue({ id: "user-del" })
  })

  it("returns 401 when not authenticated", async () => {
    mockGetSessionUser.mockResolvedValue(null)
    const res = await DELETE()
    expect(res.status).toBe(401)
    expect(prismaMock.user.delete).not.toHaveBeenCalled()
  })

  it("tears down every containered workspace BEFORE deleting the user (no orphaned services)", async () => {
    ;(prismaMock.workspace.findMany as MockFn).mockResolvedValue([
      { id: "ws-a" },
      { id: "ws-b" },
    ])

    const res = await DELETE()
    expect(res.status).toBe(200)

    expect(prismaMock.workspace.findMany).toHaveBeenCalledWith({
      where: { userId: "user-del", containerId: { not: null } },
      select: { id: true },
    })
    expect(mockDestroyContainer).toHaveBeenCalledWith("ws-a")
    expect(mockDestroyContainer).toHaveBeenCalledWith("ws-b")
    // Teardown strictly precedes the cascading user delete.
    expect(Math.max(...mockDestroyContainer.mock.invocationCallOrder)).toBeLessThan(
      (prismaMock.user.delete as MockFn).mock.invocationCallOrder[0],
    )
  })

  it("a failing teardown is logged and does NOT strand the deletion (pool sweeper owns stragglers)", async () => {
    ;(prismaMock.workspace.findMany as MockFn).mockResolvedValue([
      { id: "ws-a" },
      { id: "ws-b" },
    ])
    mockDestroyContainer.mockRejectedValueOnce(new Error("Railway 503"))

    const res = await DELETE()
    expect(res.status).toBe(200)
    expect(mockDestroyContainer).toHaveBeenCalledTimes(2)
    expect(prismaMock.user.delete).toHaveBeenCalledWith({ where: { id: "user-del" } })
  })

  it("no containered workspaces -> straight delete", async () => {
    ;(prismaMock.workspace.findMany as MockFn).mockResolvedValue([])
    const res = await DELETE()
    expect(res.status).toBe(200)
    expect(mockDestroyContainer).not.toHaveBeenCalled()
    expect(prismaMock.user.delete).toHaveBeenCalled()
  })
})
