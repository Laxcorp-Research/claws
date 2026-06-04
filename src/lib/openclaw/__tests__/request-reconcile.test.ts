// Tests for the event-triggered fan-out (PR-8b/A). healWorkspace is mocked (its
// own behavior is covered in heal-workspace.test.ts); here we assert scope +
// fan-out + per-workspace error isolation + summary.
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

const mockHeal = vi.fn()
vi.mock("@/lib/openclaw/heal-workspace", () => ({
  healWorkspace: (...a: unknown[]) => mockHeal(...a),
}))

vi.mock("@/lib/logger", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))

import { requestReconcileForUser, requestReconcileWorkspace } from "@/lib/openclaw/request-reconcile"
import { log } from "@/lib/logger"

const fn = (m: unknown) => m as unknown as Mock
const wsList = (...ids: string[]) => ids.map((id) => ({ id }))

beforeEach(() => {
  vi.clearAllMocks()
  mockHeal.mockResolvedValue({ ok: true, action: "healed" })
  fn(prismaMock.workspace.findMany).mockResolvedValue([])
})

describe("requestReconcileForUser", () => {
  it("0 RUNNING workspaces → no heal calls, resolves cleanly", async () => {
    fn(prismaMock.workspace.findMany).mockResolvedValue([])
    await expect(requestReconcileForUser("u1")).resolves.toBeUndefined()
    expect(mockHeal).not.toHaveBeenCalled()
  })

  it("scopes the query to the user's RUNNING + containerId-present workspaces", async () => {
    fn(prismaMock.workspace.findMany).mockResolvedValue(wsList("w1"))
    await requestReconcileForUser("u1")
    expect(prismaMock.workspace.findMany).toHaveBeenCalledWith({
      where: { userId: "u1", status: "RUNNING", containerId: { not: null } },
      select: { id: true },
    })
  })

  it("1 RUNNING → 1 heal call with that workspace id", async () => {
    fn(prismaMock.workspace.findMany).mockResolvedValue(wsList("w1"))
    await requestReconcileForUser("u1")
    expect(mockHeal).toHaveBeenCalledTimes(1)
    expect(mockHeal).toHaveBeenCalledWith("w1")
  })

  it("3 RUNNING → 3 heal calls", async () => {
    fn(prismaMock.workspace.findMany).mockResolvedValue(wsList("w1", "w2", "w3"))
    await requestReconcileForUser("u1")
    expect(mockHeal).toHaveBeenCalledTimes(3)
  })

  it("mixed outcomes → summary log captures each action + errors", async () => {
    fn(prismaMock.workspace.findMany).mockResolvedValue(wsList("w1", "w2", "w3", "w4"))
    mockHeal
      .mockResolvedValueOnce({ ok: true, action: "healed" })
      .mockResolvedValueOnce({ ok: true, action: "cooldown_skipped" })
      .mockResolvedValueOnce({ ok: true, action: "detect_only_noop" })
      .mockResolvedValueOnce({ ok: false, error: "boom" })
    await requestReconcileForUser("u1")
    expect(log.info).toHaveBeenCalledWith(
      "requestReconcileForUser complete",
      expect.objectContaining({ workspaces: 4, healed: 1, cooldown_skipped: 1, detect_only_noop: 1, errors: 1 }),
    )
  })

  it("one heal throws unexpectedly → others still process (loop not aborted)", async () => {
    fn(prismaMock.workspace.findMany).mockResolvedValue(wsList("w1", "w2", "w3"))
    mockHeal
      .mockResolvedValueOnce({ ok: true, action: "healed" })
      .mockRejectedValueOnce(new Error("unexpected"))
      .mockResolvedValueOnce({ ok: true, action: "healed" })
    await requestReconcileForUser("u1")
    expect(mockHeal).toHaveBeenCalledTimes(3)
    expect(log.info).toHaveBeenCalledWith(
      "requestReconcileForUser complete",
      expect.objectContaining({ healed: 2, errors: 1 }),
    )
  })

  it("scope query failure → logs error, no heal, resolves (never throws)", async () => {
    fn(prismaMock.workspace.findMany).mockRejectedValue(new Error("db down"))
    await expect(requestReconcileForUser("u1")).resolves.toBeUndefined()
    expect(mockHeal).not.toHaveBeenCalled()
    expect(log.error).toHaveBeenCalledWith(
      "requestReconcileForUser: scope query failed",
      expect.objectContaining({ error: "db down" }),
    )
  })
})

describe("requestReconcileWorkspace", () => {
  it("delegates to healWorkspace and returns its result", async () => {
    mockHeal.mockResolvedValue({ ok: true, action: "cooldown_skipped" })
    const r = await requestReconcileWorkspace("w5")
    expect(mockHeal).toHaveBeenCalledWith("w5")
    expect(r).toEqual({ ok: true, action: "cooldown_skipped" })
  })
})
