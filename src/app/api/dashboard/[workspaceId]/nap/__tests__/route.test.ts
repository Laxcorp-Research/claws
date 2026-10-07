import { beforeEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))
vi.mock("@/lib/api/auth", () => ({
  getSessionUser: vi.fn().mockResolvedValue({ id: "user-1" }),
}))
const hibernate = vi.fn()
vi.mock("@/lib/hibernation/manager", () => ({
  hibernateWorkspace: (...args: unknown[]) => hibernate(...args),
}))

import { POST } from "@/app/api/dashboard/[workspaceId]/nap/route"

type MockFn = ReturnType<typeof vi.fn>

beforeEach(() => {
  hibernate.mockReset()
  ;(prismaMock.workspace.findUnique as MockFn).mockResolvedValue({
    userId: "user-1",
    status: "RUNNING",
    containerId: "ctr-1",
  })
})

describe("POST nap", () => {
  it("hibernates a running workspace", async () => {
    hibernate.mockResolvedValue({ hibernated: true })
    const res = await POST(new Request("http://localhost/nap", { method: "POST" }) as never, {
      params: Promise.resolve({ workspaceId: "ws-1" }),
    })
    expect(res.status).toBe(200)
    expect(hibernate).toHaveBeenCalledWith("ws-1")
  })

  it("returns the refusal reason when hibernate keeps the container up", async () => {
    hibernate.mockResolvedValue({ hibernated: false, refused: true, reason: "stale-snapshot" })
    const res = await POST(new Request("http://localhost/nap", { method: "POST" }) as never, {
      params: Promise.resolve({ workspaceId: "ws-1" }),
    })
    expect(res.status).toBe(409)
  })
})
