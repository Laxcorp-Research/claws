// PR2.8a-fix1 Task 7 — integration test for GET /api/tools/[ws]/browse.
//
// Lock: comingSoon entries from the static catalog must be filtered out of
// the browse-endpoint payload. Belt-and-suspenders with the client-side
// filter in BrowseToolsModal — server filter is the primary defense
// against users hitting the OAuth flow on a RED-state toolkit, client
// filter is the fallback when the modal falls back to the static
// `ALL_TOOLS` import on fetch failure.

import { describe, it, expect, vi } from "vitest"
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
// Live Composio catalog returns empty so we test only the static-catalog
// filter behavior (live entries never set comingSoon — see
// composio-catalog.ts:toolkitItemToToolDefinition).
vi.mock("@/lib/composio-catalog", () => ({
  getComposioCatalogTools: vi.fn().mockResolvedValue([]),
}))

import { GET } from "@/app/api/tools/[workspaceId]/browse/route"

describe("GET /api/tools/[workspaceId]/browse — comingSoon filter (PR2.8a-fix1 Task 7)", () => {
  it("response payload excludes every static-catalog entry flagged comingSoon: true", async () => {
    const req = createMockRequest("http://localhost:3000/api/tools/ws-1/browse")
    const res = await GET(req, { params: Promise.resolve({ workspaceId: "ws-1" }) })
    const { status, data } = await parseResponse(res)

    expect(status).toBe(200)
    expect(data.success).toBe(true)
    const tools: Array<{ slug: string; comingSoon?: boolean }> = data.data.tools

    // Every entry in the response is a non-comingSoon entry.
    for (const t of tools) {
      expect(t.comingSoon, `slug "${t.slug}" leaked through despite comingSoon=true`).not.toBe(true)
    }

    const slugs = new Set(tools.map((t) => t.slug))

    // PR2.9 update: the comingSoon set shrunk from 11 to 2. Of the
    // original 11 PR2.8a-fix1 comingSoon slugs, 9 became BYOK-shippable
    // (drop comingSoon) and 2 stayed OAuth-only (keep comingSoon).
    //
    // Spot-check: the 2 still-blocked slugs are absent.
    for (const blocked of ["twitter", "docusign"]) {
      expect(slugs.has(blocked), `expected slug "${blocked}" filtered (OAuth-only, comingSoon)`).toBe(false)
    }

    // Spot-check: the 9 BYOK-shippable slugs DO surface now (PR2.9).
    for (const shipping of [
      "typefully",
      "jotform",
      "toggl",
      "shopify",
      "lever",
      "metaads",
      "pipedrive",
      "webflow",
      "follow_up_boss",
    ]) {
      expect(slugs.has(shipping), `expected BYOK slug "${shipping}" to surface (PR2.9)`).toBe(true)
    }

    // Sanity: GREEN/YELLOW slugs that have always been deployable still surface.
    expect(slugs.has("gmail")).toBe(true)
    expect(slugs.has("outlook")).toBe(true)
    expect(slugs.has("hubspot")).toBe(true)
  })
})
