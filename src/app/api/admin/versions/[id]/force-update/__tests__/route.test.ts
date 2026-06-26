// PR (version-ui-honesty): the admin Force-Update email must be TRUTHFUL — it
// schedules a change that applies on the next redeploy; it must NOT claim a
// security patch was already applied (the highest-risk falsehood: telling a
// user a vulnerability is closed while the vulnerable container still runs).
// These lock the copy so the old "applied / no action needed" wording can't
// come back.

import { describe, it, expect, vi, beforeEach } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { createMockRequest } from "@/test/helpers/mock-request"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

const mockRequireAdmin = vi.fn()
vi.mock("@/lib/api/admin", () => ({ requireAdmin: () => mockRequireAdmin() }))

vi.mock("@/lib/security/audit-log", () => ({ logAdminAction: vi.fn() }))

const mockSend = vi.fn()
vi.mock("resend", () => ({
  // Must be constructable (`new Resend(...)`); an arrow impl is not a
  // constructor, so use a class.
  Resend: class {
    emails = { send: (...a: unknown[]) => mockSend(...a) }
  },
}))

import { POST } from "@/app/api/admin/versions/[id]/force-update/route"

async function callRoute(id = "ver-4") {
  const req = createMockRequest(`http://localhost:3000/api/admin/versions/${id}/force-update`, {
    method: "POST",
  })
  return POST(req, { params: Promise.resolve({ id }) })
}

beforeEach(() => {
  mockRequireAdmin.mockReset()
  mockRequireAdmin.mockResolvedValue({ id: "admin-1", email: "admin@buildclaws.ai" })
  mockSend.mockReset()
  mockSend.mockResolvedValue({ id: "email-1" })
  ;(prismaMock.openClawVersion.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "ver-4",
    version: "2026.5.22-4",
    dockerImage: "ghcr.io/laxcorp-research/openclaw-runtime:2026.5.22-4",
    isStable: true,
    releaseNotes: null,
  })
  ;(prismaMock.deployment.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
    {
      id: "dep-1",
      workspace: { id: "ws-1", name: "My Claw", userId: "user-1", user: { email: "u@x.com", name: "U" } },
    },
  ])
  ;(prismaMock.deployment.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1 })
})

describe("POST /api/admin/versions/[id]/force-update — truthful scheduled copy", () => {
  it("emails a SCHEDULED notice that says the Claw has NOT been updated yet", async () => {
    const res = await callRoute()
    await new Promise((r) => setTimeout(r, 0)) // flush the fire-and-forget email promise

    expect(res.status).toBe(200)
    expect(mockSend).toHaveBeenCalledTimes(1)
    const email = mockSend.mock.calls[0][0] as { subject: string; html: string }

    expect(email.subject).toMatch(/scheduled/i)
    expect(email.html).toMatch(/Security Update Scheduled/i)
    expect(email.html).toMatch(/NOT been updated yet/i)
    expect(email.html).toMatch(/next redeploy/i)
  })

  it("does NOT claim the update was applied or that no action is needed", async () => {
    await callRoute()
    await new Promise((r) => setTimeout(r, 0))

    const email = mockSend.mock.calls[0][0] as { subject: string; html: string }
    expect(email.subject).not.toMatch(/applied/i)
    expect(email.html).not.toMatch(/Security Update Applied/i)
    expect(email.html).not.toMatch(/we've updated your claw/i)
    expect(email.html).not.toMatch(/no action is needed/i)
  })

  it("returns a queued/next-redeploy message, not 'initiated'", async () => {
    const res = await callRoute()
    const json = await res.json()
    expect(json.data.message).toMatch(/queued .*next redeploy/i)
    expect(json.data.message).not.toMatch(/initiated/i)
  })
})
