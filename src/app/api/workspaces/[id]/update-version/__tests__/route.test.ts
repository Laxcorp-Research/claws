// PR (version-ui-honesty): the per-workspace update action must NEVER write an
// OLDER containerImage (the silent-downgrade path is the real correctness bug).
// It only re-points Deployment.containerImage when the stable row is genuinely
// newer than the deployed image, and reports a truthful "queued — applies on
// next redeploy" (nothing restarts here).

import { describe, it, expect, vi, beforeEach } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { createMockRequest } from "@/test/helpers/mock-request"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

const mockGetSessionUser = vi.fn()
vi.mock("@/lib/api/auth", () => ({ getSessionUser: () => mockGetSessionUser() }))

import { POST } from "@/app/api/workspaces/[id]/update-version/route"

const IMG = (v: string) => `ghcr.io/laxcorp-research/openclaw-runtime:${v}`

async function callRoute(id = "ws-1") {
  const req = createMockRequest(`http://localhost:3000/api/workspaces/${id}/update-version`, {
    method: "POST",
  })
  return POST(req, { params: Promise.resolve({ id }) })
}

function setup({ stable, deployed }: { stable: string; deployed: string }) {
  mockGetSessionUser.mockResolvedValue({ id: "user-1" })
  ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({ userId: "user-1" })
  ;(prismaMock.openClawVersion.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
    version: stable,
    dockerImage: IMG(stable),
  })
  ;(prismaMock.deployment.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "dep-1",
    containerImage: IMG(deployed),
  })
  ;(prismaMock.deployment.update as ReturnType<typeof vi.fn>).mockResolvedValue({})
}

beforeEach(() => {
  mockGetSessionUser.mockReset()
  ;(prismaMock.deployment.update as ReturnType<typeof vi.fn>).mockReset()
})

describe("POST /api/workspaces/[id]/update-version — no-downgrade guard", () => {
  it("DOES NOT write an older image when deployed (-3) is newer than stable (-2)", async () => {
    setup({ stable: "2026.5.22-2", deployed: "2026.5.22-3" })

    const res = await callRoute()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.queued).toBe(false)
    expect(json.data.message).toMatch(/already on the latest/i)
    // The correctness guard: no downgrade write.
    expect(prismaMock.deployment.update).not.toHaveBeenCalled()
  })

  it("does not write when deployed equals stable", async () => {
    setup({ stable: "2026.5.22-3", deployed: "2026.5.22-3" })

    const res = await callRoute()
    const json = await res.json()

    expect(json.data.queued).toBe(false)
    expect(prismaMock.deployment.update).not.toHaveBeenCalled()
  })

  it("FAIL-SAFE: does not write when the deployed image is unparseable", async () => {
    setup({ stable: "2026.5.22-3", deployed: "latest" })

    await callRoute()

    expect(prismaMock.deployment.update).not.toHaveBeenCalled()
  })

  it("queues (re-points containerImage) when stable (-3) is genuinely newer than deployed (-2)", async () => {
    setup({ stable: "2026.5.22-3", deployed: "2026.5.22-2" })

    const res = await callRoute()
    const json = await res.json()

    expect(prismaMock.deployment.update).toHaveBeenCalledWith({
      where: { id: "dep-1" },
      data: { containerImage: IMG("2026.5.22-3") },
    })
    expect(json.data.queued).toBe(true)
    expect(json.data.message).toMatch(/queued .*next redeploy/i)
    expect(json.data.newVersion).toBe("2026.5.22-3")
  })
})
