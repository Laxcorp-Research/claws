import { beforeEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { createMockRequest } from "@/test/helpers/mock-request"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

const mockGetSessionUser = vi.fn()
vi.mock("@/lib/api/auth", () => ({ getSessionUser: () => mockGetSessionUser() }))

import { POST } from "../route"

describe("POST /api/marketplace/skills/[slug]/reviews - own listing", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSessionUser.mockResolvedValue({ id: "user-1" })
  })

  it("refuses creator reviewing own skill even with an install", async () => {
    prismaMock.marketplaceSkill.findUnique.mockResolvedValue({
      id: "skill-1",
      creator: { userId: "user-1" },
    } as never)
    prismaMock.skillInstall.findUnique.mockResolvedValue({ id: "inst-1" } as never)

    const req = createMockRequest("http://localhost:3000/api/marketplace/skills/own/reviews", {
      method: "POST",
      body: { rating: 5 },
    })
    const res = await POST(req, { params: Promise.resolve({ slug: "own" }) })
    const json = await res.json()
    expect(res.status).toBe(403)
    expect(json.error?.code).toBe("OWN_LISTING")
    expect(json.error?.message).toBe("This is your skill")
    expect(prismaMock.skillReview.create).not.toHaveBeenCalled()
  })

  it("MUTATION: own-listing review gate removed → fail", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/api/marketplace/skills/[slug]/reviews/route.ts"),
      "utf8",
    )
    expect(src).toContain("isOwnListing")
    expect(src).toContain("OWN_LISTING")
    expect(src).toContain('ownListingMessage("skill")')
  })
})
