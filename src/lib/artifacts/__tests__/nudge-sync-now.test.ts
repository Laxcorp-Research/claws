import { beforeEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))
vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const mockTrySyncNow = vi.fn()
vi.mock("@/lib/openclaw/sync-now", () => ({
  DEFAULT_SYNC_TIMEOUT_MS: 18_000,
  trySyncNow: (...args: unknown[]) => mockTrySyncNow(...args),
}))

import { nudgeDeliverableSyncNow } from "@/lib/artifacts/nudge-sync-now"

describe("nudgeDeliverableSyncNow", () => {
  beforeEach(() => {
    mockTrySyncNow.mockReset()
    mockTrySyncNow.mockResolvedValue({ synced: true })
  })

  it("calls trySyncNow when the workspace has a container host", async () => {
    ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      containerHost: "claw-ws.up.railway.app",
    })
    await nudgeDeliverableSyncNow("ws-1")
    expect(mockTrySyncNow).toHaveBeenCalledWith("claw-ws.up.railway.app", 18_000)
  })

  it("skips when there is no container host", async () => {
    ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      containerHost: null,
    })
    await nudgeDeliverableSyncNow("ws-1")
    expect(mockTrySyncNow).not.toHaveBeenCalled()
  })
})
