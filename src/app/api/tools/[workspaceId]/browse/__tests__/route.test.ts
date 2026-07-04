// B2 — integration test for GET /api/tools/[ws]/browse.
// Locks full catalog exposure: custom-OAuth blocked rows remain visible with
// honest metadata, and live Composio catalog rows are merged without paging loss.

import { beforeEach, describe, it, expect, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { createMockRequest, parseResponse } from "@/test/helpers/mock-request"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))
vi.mock("@/lib/api/auth", () => ({
  getSessionUser: vi.fn().mockResolvedValue({
    id: "user-test-1",
    email: "test@example.com",
  }),
}))
vi.mock("@/lib/api/ownership", () => ({
  verifyWorkspaceOwnership: vi.fn().mockResolvedValue({ error: null }),
}))
const mockGetComposioCatalogTools = vi.fn()
vi.mock("@/lib/composio-catalog", () => ({
  getComposioCatalogTools: (...args: unknown[]) => mockGetComposioCatalogTools(...args),
}))

import { GET, __resetBrowseToolsCacheForTests } from "@/app/api/tools/[workspaceId]/browse/route"

describe("GET /api/tools/[workspaceId]/browse — full catalog exposure (B2)", () => {
  beforeEach(() => {
    __resetBrowseToolsCacheForTests()
    mockGetComposioCatalogTools.mockReset()
  })

  it("keeps custom-OAuth comingSoon rows visible while formerly hidden non-custom rows are connectable", async () => {
    mockGetComposioCatalogTools.mockResolvedValue([])
    const req = createMockRequest("http://localhost:3000/api/tools/ws-1/browse")
    const res = await GET(req, { params: Promise.resolve({ workspaceId: "ws-1" }) })
    const { status, data } = await parseResponse(res)

    expect(status).toBe(200)
    expect(data.success).toBe(true)
    const tools: Array<{ slug: string; comingSoon?: boolean; authMode?: string }> = data.data.tools

    const slugs = new Set(tools.map((t) => t.slug))

    // The 2 still-blocked custom-OAuth slugs are visible but marked blocked.
    for (const blocked of ["twitter", "docusign"]) {
      const row = tools.find((t) => t.slug === blocked)
      expect(row, `expected blocked slug "${blocked}" to remain visible`).toBeDefined()
      expect(row?.comingSoon).toBe(true)
      expect(row?.authMode).toBe("custom-oauth-required")
    }

    // Former placeholder rows now surface as connectable via the Composio broker path.
    for (const shipping of [
      "buffer",
      "wordpress",
      "greenhouse",
      "smartlead",
    ]) {
      const row = tools.find((t) => t.slug === shipping)
      expect(row, `expected slug "${shipping}" to surface`).toBeDefined()
      expect(row?.comingSoon).not.toBe(true)
    }

    expect(slugs.has("gmail")).toBe(true)
    expect(slugs.has("outlook")).toBe(true)
    expect(slugs.has("hubspot")).toBe(true)
  })

  it("exposes merged live catalog counts above 1000 with mocked Composio pages", async () => {
    mockGetComposioCatalogTools.mockResolvedValue(
      Array.from({ length: 1100 }, (_, i) => ({
        slug: `live-tool-${i}`,
        name: `Live Tool ${i}`,
        connectionType: "OAUTH_COMPOSIO",
        authMode: "managed-oauth",
        category: "LIVE",
        composioToolkitId: `live-tool-${i}`,
        credentialFields: [],
      })),
    )

    const req = createMockRequest("http://localhost:3000/api/tools/ws-1/browse")
    const res = await GET(req, { params: Promise.resolve({ workspaceId: "ws-1" }) })
    const { status, data } = await parseResponse(res)

    expect(status).toBe(200)
    expect(data.data.total).toBeGreaterThan(1000)
    expect(data.data.tools.some((t: { slug: string }) => t.slug === "live-tool-1099")).toBe(true)
  })
})
