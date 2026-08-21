import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { createMockRequest, parseResponse } from "@/test/helpers/mock-request"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))
vi.mock("@/lib/api/auth", () => ({
  getSessionUser: vi.fn().mockResolvedValue(null),
}))
vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), marketplaceEvent: vi.fn() },
}))

import { getSessionUser } from "@/lib/api/auth"
import { POST as unpublishTemplate } from "@/app/api/marketplace/templates/[slug]/unpublish/route"
import { POST as publishAgainTemplate } from "@/app/api/marketplace/templates/[slug]/publish-again/route"
import { DELETE as deleteTemplate } from "@/app/api/marketplace/templates/[slug]/route"
import { POST as unpublishSkill } from "@/app/api/marketplace/skills/[slug]/unpublish/route"
import { POST as publishAgainSkill } from "@/app/api/marketplace/skills/[slug]/publish-again/route"
import { DELETE as deleteSkill } from "@/app/api/marketplace/skills/[slug]/route"
import { GET as getTemplateDetail } from "@/app/api/marketplace/templates/[slug]/route"
import { GET as getSkillDetail } from "@/app/api/marketplace/skills/[slug]/route"

const ROOT = process.cwd()

process.env.MARKETPLACE_PUBLISH_ENABLED = "true"

const ownedTemplate = {
  id: "tpl-1",
  slug: "my-claw",
  name: "My Claw",
  isPublished: true,
  reviewStatus: "APPROVED",
  trustTier: "SCANNED",
  creatorId: "cp-1",
  creator: { id: "cp-1", userId: "creator-1" },
}

const ownedSkill = {
  id: "sk-1",
  slug: "my-skill",
  name: "My Skill",
  isPublished: true,
  reviewStatus: "APPROVED",
  trustTier: "SCANNED",
  creatorId: "cp-1",
  creator: { id: "cp-1", userId: "creator-1" },
}

function asOwner() {
  vi.mocked(getSessionUser).mockResolvedValue({ id: "creator-1", email: "c@test.com" } as never)
}

describe("creator unpublish / publish-again / delete", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    asOwner()
    process.env.MARKETPLACE_PUBLISH_ENABLED = "true"
    prismaMock.marketplaceSale.count.mockResolvedValue(0)
    prismaMock.purchase.count.mockResolvedValue(0)
    prismaMock.templateInstall.count.mockResolvedValue(0)
    prismaMock.skillInstall.count.mockResolvedValue(0)
    prismaMock.clawTemplate.update.mockResolvedValue(ownedTemplate as never)
    prismaMock.marketplaceSkill.update.mockResolvedValue(ownedSkill as never)
    prismaMock.clawTemplate.delete.mockResolvedValue(ownedTemplate as never)
    prismaMock.marketplaceSkill.delete.mockResolvedValue(ownedSkill as never)
    prismaMock.creatorProfile.update.mockResolvedValue({} as never)
  })

  it("unpublish always allowed for owner of a published listing", async () => {
    prismaMock.clawTemplate.findUnique.mockResolvedValue(ownedTemplate as never)
    const res = await unpublishTemplate(
      createMockRequest("http://localhost/api/marketplace/templates/my-claw/unpublish", {
        method: "POST",
      }),
      { params: Promise.resolve({ slug: "my-claw" }) },
    )
    const { status, data } = await parseResponse(res)
    expect(status).toBe(200)
    expect(data.data.isPublished).toBe(false)
    expect(prismaMock.clawTemplate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { isPublished: false },
      }),
    )
  })

  it("unpublish with sales still allowed (does not delete)", async () => {
    prismaMock.clawTemplate.findUnique.mockResolvedValue(ownedTemplate as never)
    prismaMock.marketplaceSale.count.mockResolvedValue(4)
    prismaMock.templateInstall.count.mockResolvedValue(4)
    const res = await unpublishTemplate(
      createMockRequest("http://localhost/api/marketplace/templates/my-claw/unpublish", {
        method: "POST",
      }),
      { params: Promise.resolve({ slug: "my-claw" }) },
    )
    expect(res.status).toBe(200)
    expect(prismaMock.clawTemplate.delete).not.toHaveBeenCalled()
    expect(prismaMock.marketplaceSale.delete).not.toHaveBeenCalled()
  })

  it("0 sales delete ok", async () => {
    prismaMock.clawTemplate.findUnique.mockResolvedValue({
      ...ownedTemplate,
      isPublished: false,
    } as never)
    const res = await deleteTemplate(
      createMockRequest("http://localhost/api/marketplace/templates/my-claw", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ slug: "my-claw" }) },
    )
    expect(res.status).toBe(200)
    expect(prismaMock.clawTemplate.delete).toHaveBeenCalledWith({ where: { id: "tpl-1" } })
  })

  it(">0 installs delete blocked with honest copy", async () => {
    prismaMock.clawTemplate.findUnique.mockResolvedValue(ownedTemplate as never)
    prismaMock.templateInstall.count.mockResolvedValue(5)
    const res = await deleteTemplate(
      createMockRequest("http://localhost/api/marketplace/templates/my-claw", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ slug: "my-claw" }) },
    )
    const { status, data } = await parseResponse(res)
    expect(status).toBe(409)
    expect(data.error.code).toBe("DELETE_BLOCKED")
    expect(data.error.message).toBe(
      "5 people installed this - you can unpublish but not delete",
    )
    expect(prismaMock.clawTemplate.delete).not.toHaveBeenCalled()
  })

  it("stranger cannot unpublish", async () => {
    prismaMock.clawTemplate.findUnique.mockResolvedValue(ownedTemplate as never)
    vi.mocked(getSessionUser).mockResolvedValue({ id: "stranger", email: "s@test.com" } as never)
    const res = await unpublishTemplate(
      createMockRequest("http://localhost/api/marketplace/templates/my-claw/unpublish", {
        method: "POST",
      }),
      { params: Promise.resolve({ slug: "my-claw" }) },
    )
    expect(res.status).toBe(403)
    expect(prismaMock.clawTemplate.update).not.toHaveBeenCalled()
  })

  it("publish again sets PENDING via existing review path", async () => {
    prismaMock.clawTemplate.findUnique.mockResolvedValue({
      ...ownedTemplate,
      isPublished: false,
      reviewStatus: "APPROVED",
    } as never)
    const res = await publishAgainTemplate(
      createMockRequest("http://localhost/api/marketplace/templates/my-claw/publish-again", {
        method: "POST",
      }),
      { params: Promise.resolve({ slug: "my-claw" }) },
    )
    expect(res.status).toBe(200)
    expect(prismaMock.clawTemplate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ reviewStatus: "PENDING" }),
      }),
    )
  })

  it("skill: 0 sales delete ok / >0 blocked / unpublish always", async () => {
    prismaMock.marketplaceSkill.findUnique.mockResolvedValue(ownedSkill as never)
    const unpub = await unpublishSkill(
      createMockRequest("http://localhost/api/marketplace/skills/my-skill/unpublish", {
        method: "POST",
      }),
      { params: Promise.resolve({ slug: "my-skill" }) },
    )
    expect(unpub.status).toBe(200)

    prismaMock.skillInstall.count.mockResolvedValue(2)
    const blocked = await deleteSkill(
      createMockRequest("http://localhost/api/marketplace/skills/my-skill", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ slug: "my-skill" }) },
    )
    expect(blocked.status).toBe(409)

    prismaMock.skillInstall.count.mockResolvedValue(0)
    prismaMock.marketplaceSale.count.mockResolvedValue(0)
    const ok = await deleteSkill(
      createMockRequest("http://localhost/api/marketplace/skills/my-skill", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ slug: "my-skill" }) },
    )
    expect(ok.status).toBe(200)
    expect(prismaMock.marketplaceSkill.delete).toHaveBeenCalledWith({ where: { id: "sk-1" } })
  })

  it("skill publish again sets PENDING", async () => {
    prismaMock.marketplaceSkill.findUnique.mockResolvedValue({
      ...ownedSkill,
      isPublished: false,
    } as never)
    const res = await publishAgainSkill(
      createMockRequest("http://localhost/api/marketplace/skills/my-skill/publish-again", {
        method: "POST",
      }),
      { params: Promise.resolve({ slug: "my-skill" }) },
    )
    expect(res.status).toBe(200)
    expect(prismaMock.marketplaceSkill.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ reviewStatus: "PENDING" }),
      }),
    )
  })

  it("unpublished detail: public 404, owner unpublished state", async () => {
    const unpublished = {
      ...ownedTemplate,
      isPublished: false,
      reviewStatus: "APPROVED",
      creator: null,
    }
    prismaMock.clawTemplate.findUnique.mockResolvedValue(unpublished as never)
    prismaMock.creatorProfile.findUnique.mockResolvedValue({ userId: "creator-1" } as never)

    vi.mocked(getSessionUser).mockResolvedValue(null)
    const publicRes = await getTemplateDetail(
      createMockRequest("http://localhost/api/marketplace/templates/my-claw"),
      { params: Promise.resolve({ slug: "my-claw" }) },
    )
    expect(publicRes.status).toBe(404)

    asOwner()
    const ownerRes = await getTemplateDetail(
      createMockRequest("http://localhost/api/marketplace/templates/my-claw"),
      { params: Promise.resolve({ slug: "my-claw" }) },
    )
    const ownerBody = await parseResponse(ownerRes)
    expect(ownerRes.status).toBe(200)
    expect(ownerBody.data.data.listingState).toBe("unpublished")
  })

  it("unpublished skill detail: public 404, owner unpublished state", async () => {
    prismaMock.marketplaceSkill.findUnique.mockResolvedValue({
      ...ownedSkill,
      isPublished: false,
    } as never)
    prismaMock.creatorProfile.findUnique.mockResolvedValue({ userId: "creator-1" } as never)

    vi.mocked(getSessionUser).mockResolvedValue(null)
    const publicRes = await getSkillDetail(
      createMockRequest("http://localhost/api/marketplace/skills/my-skill"),
      { params: Promise.resolve({ slug: "my-skill" }) },
    )
    expect(publicRes.status).toBe(404)

    asOwner()
    const ownerRes = await getSkillDetail(
      createMockRequest("http://localhost/api/marketplace/skills/my-skill"),
      { params: Promise.resolve({ slug: "my-skill" }) },
    )
    const ownerBody = await parseResponse(ownerRes)
    expect(ownerRes.status).toBe(200)
    expect(ownerBody.data.data.listingState).toBe("unpublished")
  })
})

describe("MUTATION: cascade-delete / guard", () => {
  it("cascade-delete restored → fail", () => {
    const actions = readFileSync(
      join(ROOT, "src/lib/marketplace/creator-listing-actions.ts"),
      "utf8",
    )
    const templateRoute = readFileSync(
      join(ROOT, "src/app/api/marketplace/templates/[slug]/route.ts"),
      "utf8",
    )
    const skillRoute = readFileSync(
      join(ROOT, "src/app/api/marketplace/skills/[slug]/route.ts"),
      "utf8",
    )
    for (const src of [actions, templateRoute, skillRoute]) {
      expect(src).not.toMatch(/marketplaceSale\.delete/)
      expect(src).not.toMatch(/purchase\.delete/)
      expect(src).not.toMatch(/templateInstall\.delete/)
      expect(src).not.toMatch(/skillInstall\.delete/)
      expect(src).not.toMatch(/templateReview\.delete/)
      expect(src).not.toMatch(/skillReview\.delete/)
      expect(src).not.toMatch(/reviews:\s*\{\s*deleteMany/)
      expect(src).not.toMatch(/installs:\s*\{\s*deleteMany/)
      expect(src).not.toMatch(/sales:\s*\{\s*deleteMany/)
    }
  })

  it("guard removed → fail", () => {
    const actions = readFileSync(
      join(ROOT, "src/lib/marketplace/creator-listing-actions.ts"),
      "utf8",
    )
    const lifecycle = readFileSync(
      join(ROOT, "src/lib/marketplace/creator-listing-lifecycle.ts"),
      "utf8",
    )
    expect(lifecycle).toContain("salesCount === 0 && installCount === 0")
    expect(actions).toContain("canDeleteCreatorListing")
    const deleteTemplateFn = actions.slice(
      actions.indexOf("export async function deleteTemplate"),
      actions.indexOf("export async function deleteSkill"),
    )
    const deleteSkillFn = actions.slice(actions.indexOf("export async function deleteSkill"))
    expect(deleteTemplateFn).toContain("canDeleteCreatorListing")
    expect(deleteTemplateFn).toMatch(/clawTemplate\.delete/)
    expect(deleteSkillFn).toContain("canDeleteCreatorListing")
    expect(deleteSkillFn).toMatch(/marketplaceSkill\.delete/)
    expect(deleteTemplateFn.indexOf("canDeleteCreatorListing")).toBeLessThan(
      deleteTemplateFn.indexOf("clawTemplate.delete"),
    )
    expect(deleteSkillFn.indexOf("canDeleteCreatorListing")).toBeLessThan(
      deleteSkillFn.indexOf("marketplaceSkill.delete"),
    )
  })
})
