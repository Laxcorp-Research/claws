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

import { GET as getTemplateDetail } from "@/app/api/marketplace/templates/[slug]/route"
import { GET as getSkillDetail } from "@/app/api/marketplace/skills/[slug]/route"
import { POST as installSkill } from "@/app/api/marketplace/skills/[slug]/install/route"
import { getSessionUser } from "@/lib/api/auth"
import { POST as rejectTemplate } from "@/app/api/admin/review-queue/templates/[id]/reject/route"
import { POST as approveTemplate } from "@/app/api/admin/review-queue/templates/[id]/approve/route"
import { POST as approveSkill } from "@/app/api/admin/review-queue/skills/[id]/approve/route"

const ROOT = process.cwd()

process.env.ADMIN_EMAILS = "admin@test.com"

vi.mock("@/lib/api/admin", () => ({
  requireAdmin: vi.fn().mockResolvedValue({ id: "admin-1", email: "admin@test.com" }),
}))
vi.mock("@/lib/security/audit-log", () => ({
  logAdminAction: vi.fn(),
}))
vi.mock("@/lib/resend", () => ({
  getResend: () => ({ emails: { send: vi.fn().mockResolvedValue({ id: "e1" }) } }),
}))
vi.mock("resend", () => ({
  Resend: class {
    emails = { send: vi.fn().mockResolvedValue({ id: "e1" }) }
  },
}))

const pendingCommunity = {
  id: "tpl-pending",
  slug: "pending-community",
  name: "Pending",
  tagline: "t",
  description: "d",
  category: "CREATOR",
  price: 0,
  isFree: true,
  trustTier: "UNREVIEWED",
  reviewStatus: "PENDING",
  isPublished: false,
  installCount: 0,
  avgRating: null,
  estimatedMonthlyCost: null,
  agentCount: 1,
  version: 1,
  creatorId: "cp-1",
  creator: null,
  workspaceSnapshot: '{"agents":[],"tools":[]}',
  reviews: [],
  _count: { reviews: 0, installs: 0 },
}

const officialTemplate = {
  ...pendingCommunity,
  id: "tpl-official",
  slug: "official-claw",
  trustTier: "OFFICIAL",
  reviewStatus: "APPROVED",
  isPublished: true,
  creatorId: null,
}

describe("listing gate - public detail/install (Arc 1)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getSessionUser).mockResolvedValue(null)
  })

  it("pre-approval community template is invisible on public detail", async () => {
    prismaMock.clawTemplate.findUnique.mockResolvedValue(pendingCommunity as never)
    const res = await getTemplateDetail(
      createMockRequest("http://localhost/api/marketplace/templates/pending-community"),
      { params: Promise.resolve({ slug: "pending-community" }) },
    )
    expect(res.status).toBe(404)
  })

  it("creator viewing own pending template gets pending_review, stranger still 404", async () => {
    prismaMock.clawTemplate.findUnique.mockResolvedValue(pendingCommunity as never)
    prismaMock.creatorProfile.findUnique.mockResolvedValue({ userId: "creator-1" } as never)

    vi.mocked(getSessionUser).mockResolvedValue({ id: "creator-1", email: "c@test.com" } as never)
    const ownerRes = await getTemplateDetail(
      createMockRequest("http://localhost/api/marketplace/templates/pending-community"),
      { params: Promise.resolve({ slug: "pending-community" }) },
    )
    const ownerBody = await parseResponse(ownerRes)
    expect(ownerRes.status).toBe(200)
    expect(ownerBody.data.data.listingState).toBe("pending_review")
    expect(ownerBody.data.data.slug).toBe("pending-community")
    expect(ownerBody.data.data.template).toBeUndefined()

    vi.mocked(getSessionUser).mockResolvedValue({ id: "stranger", email: "s@test.com" } as never)
    const strangerRes = await getTemplateDetail(
      createMockRequest("http://localhost/api/marketplace/templates/pending-community"),
      { params: Promise.resolve({ slug: "pending-community" }) },
    )
    expect(strangerRes.status).toBe(404)
  })

  it("official template detail remains available (regression)", async () => {
    prismaMock.clawTemplate.findUnique.mockResolvedValue(officialTemplate as never)
    prismaMock.clawTemplate.findMany.mockResolvedValue([])
    const res = await getTemplateDetail(
      createMockRequest("http://localhost/api/marketplace/templates/official-claw"),
      { params: Promise.resolve({ slug: "official-claw" }) },
    )
    const { status, data } = await parseResponse(res)
    expect(status).toBe(200)
    expect(data.data.template.slug).toBe("official-claw")
  })

  it("detail returns slim workspaceSnapshot (no soulMd) for hierarchy preview", async () => {
    prismaMock.clawTemplate.findUnique.mockResolvedValue({
      ...officialTemplate,
      workspaceSnapshot: JSON.stringify({
        agents: [
          { name: "Lead", agentSlug: "lead", role: "ORCHESTRATOR", color: "#5BA1F5", soulMd: "SECRET SOUL" },
          { name: "Scout", agentSlug: "scout", role: "WORKER", color: "#8BFCAE", soulMd: "SECRET SOUL" },
          { name: "Gate", agentSlug: "gate", role: "CRITIC", color: "#A78BFA", soulMd: "SECRET SOUL" },
        ],
        connections: [{ sourceSlug: "lead", targetSlug: "scout", condition: "ON_COMPLETE" }],
        tools: [],
      }),
    } as never)
    prismaMock.clawTemplate.findMany.mockResolvedValue([])
    const res = await getTemplateDetail(
      createMockRequest("http://localhost/api/marketplace/templates/official-claw"),
      { params: Promise.resolve({ slug: "official-claw" }) },
    )
    const { status, data } = await parseResponse(res)
    expect(status).toBe(200)
    const snap = data.data.template.workspaceSnapshot as {
      agents: Array<Record<string, unknown>>
      connections: unknown[]
    }
    expect(snap.agents).toHaveLength(3)
    expect(snap.connections).toHaveLength(1)
    expect(JSON.stringify(snap)).not.toContain("SECRET")
    expect(snap.agents[0]).not.toHaveProperty("soulMd")
  })

  it("pre-approval skill is invisible and uninstallable", async () => {
    const pendingSkill = {
      id: "sk-1",
      slug: "pending-skill",
      isPublished: false,
      trustTier: "UNREVIEWED",
      reviewStatus: "PENDING",
      isFree: true,
      price: null,
      reviews: [],
      _count: { reviews: 0, installs: 0 },
      creator: null,
      name: "Pending Skill",
      emoji: null,
      description: "d",
      category: "CORE",
      avgRating: null,
      skillMd: "# skill",
      requiredBins: [],
      requiredEnvVars: [],
      minOpenClawVersion: null,
      publishedAt: null,
    }
    prismaMock.marketplaceSkill.findUnique.mockResolvedValue(pendingSkill as never)

    const detail = await getSkillDetail(
      createMockRequest("http://localhost/api/marketplace/skills/pending-skill"),
      { params: Promise.resolve({ slug: "pending-skill" }) },
    )
    expect(detail.status).toBe(404)

    vi.mocked(getSessionUser).mockResolvedValue({ id: "user-1", email: "u@test.com" } as never)
    prismaMock.workspace.findUnique.mockResolvedValue({
      id: "ws-1",
      userId: "user-1",
      status: "RUNNING",
      containerName: "c1",
      containerId: null,
      agents: [],
    } as never)

    const install = await installSkill(
      createMockRequest("http://localhost/api/marketplace/skills/pending-skill/install", {
        method: "POST",
        body: { workspaceId: "ws-1" },
      }),
      { params: Promise.resolve({ slug: "pending-skill" }) },
    )
    expect(install.status).toBe(404)
  })

  it("creator viewing own pending skill gets pending_review", async () => {
    const pendingSkill = {
      id: "sk-1",
      slug: "pending-skill",
      creatorId: "cp-1",
      isPublished: false,
      trustTier: "UNREVIEWED",
      reviewStatus: "PENDING",
      name: "Pending Skill",
    }
    prismaMock.marketplaceSkill.findUnique.mockResolvedValue(pendingSkill as never)
    prismaMock.creatorProfile.findUnique.mockResolvedValue({ userId: "creator-1" } as never)
    vi.mocked(getSessionUser).mockResolvedValue({ id: "creator-1", email: "c@test.com" } as never)

    const res = await getSkillDetail(
      createMockRequest("http://localhost/api/marketplace/skills/pending-skill"),
      { params: Promise.resolve({ slug: "pending-skill" }) },
    )
    const { status, data } = await parseResponse(res)
    expect(status).toBe(200)
    expect(data.data.listingState).toBe("pending_review")
    expect(data.data.skill).toBeUndefined()
  })
})

describe("admin approve/reject listing gate (Arc 1)", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("approve publishes community template as SCANNED (not VERIFIED)", async () => {
    prismaMock.clawTemplate.findUnique.mockResolvedValue({
      ...pendingCommunity,
      isPublished: false,
      reviewStatus: "PENDING",
      creator: { displayName: "C", user: { email: "c@test.com", name: "C" } },
    } as never)
    prismaMock.clawTemplate.update.mockResolvedValue({
      ...pendingCommunity,
      reviewStatus: "APPROVED",
      trustTier: "SCANNED",
      isPublished: true,
    } as never)

    const res = await approveTemplate(
      createMockRequest("http://localhost/api/admin/review-queue/templates/tpl-pending/approve", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "tpl-pending" }) },
    )
    expect(res.status).toBe(200)
    expect(prismaMock.clawTemplate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reviewStatus: "APPROVED",
          trustTier: "SCANNED",
          isPublished: true,
        }),
      }),
    )
  })

  it("reject delists (isPublished false)", async () => {
    prismaMock.clawTemplate.findUnique.mockResolvedValue({
      ...pendingCommunity,
      isPublished: true,
      reviewStatus: "PENDING",
      creator: { displayName: "C", user: { email: "c@test.com" } },
    } as never)
    prismaMock.clawTemplate.update.mockResolvedValue({
      ...pendingCommunity,
      reviewStatus: "REJECTED",
      isPublished: false,
    } as never)

    const res = await rejectTemplate(
      createMockRequest("http://localhost/api/admin/review-queue/templates/tpl-pending/reject", {
        method: "POST",
        body: { reason: "Needs work" },
      }),
      { params: Promise.resolve({ id: "tpl-pending" }) },
    )
    expect(res.status).toBe(200)
    expect(prismaMock.clawTemplate.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reviewStatus: "REJECTED",
          isPublished: false,
        }),
      }),
    )
  })

  it("skill approve with sandboxPassed still mints SCANNED when vetting env off", async () => {
    delete process.env.SANDBOX_VETTING_ENABLED
    prismaMock.marketplaceSkill.findUnique.mockResolvedValue({
      id: "sk-1",
      name: "S",
      slug: "s",
      reviewStatus: "PENDING",
      sandboxPassed: true,
      publishedAt: null,
      creator: { displayName: "C", user: { email: "c@test.com", name: "C" } },
    } as never)
    prismaMock.marketplaceSkill.update.mockResolvedValue({
      id: "sk-1",
      reviewStatus: "APPROVED",
      trustTier: "SCANNED",
      isPublished: true,
    } as never)

    const res = await approveSkill(
      createMockRequest("http://localhost/api/admin/review-queue/skills/sk-1/approve", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "sk-1" }) },
    )
    expect(res.status).toBe(200)
    expect(prismaMock.marketplaceSkill.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          trustTier: "SCANNED",
          isPublished: true,
          reviewStatus: "APPROVED",
        }),
      }),
    )
    const updateArg = vi.mocked(prismaMock.marketplaceSkill.update).mock.calls[0]?.[0] as {
      data: { trustTier: string }
    }
    expect(updateArg.data.trustTier).not.toBe("VERIFIED")
  })

  it("skill approve with jail-quality report mints VERIFIED when vetting env on", async () => {
    process.env.SANDBOX_VETTING_ENABLED = "true"
    const jailReport = JSON.stringify({
      version: 1,
      skillId: "sk-1",
      contentDigest: "a".repeat(64),
      passed: true,
      execution: "jail",
      violations: [],
      dryChecks: { bins: [], envVars: [], credPathCanaries: [] },
      agentTurn: {
        model: "claude-haiku-4-5-20251001",
        completed: true,
        summary: "Probe complete without network.",
      },
      dockerImage: "ghcr.io/laxcorp-research/openclaw-runtime:2026.5.22-4",
      finishedAt: new Date().toISOString(),
    })
    prismaMock.marketplaceSkill.findUnique.mockResolvedValue({
      id: "sk-1",
      name: "S",
      slug: "s",
      reviewStatus: "PENDING",
      sandboxPassed: true,
      sandboxReport: jailReport,
      publishedAt: null,
      creator: { displayName: "C", user: { email: "c@test.com", name: "C" } },
    } as never)
    prismaMock.marketplaceSkill.update.mockResolvedValue({
      id: "sk-1",
      reviewStatus: "APPROVED",
      trustTier: "VERIFIED",
      isPublished: true,
    } as never)

    const res = await approveSkill(
      createMockRequest("http://localhost/api/admin/review-queue/skills/sk-1/approve", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "sk-1" }) },
    )
    expect(res.status).toBe(200)
    expect(prismaMock.marketplaceSkill.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ trustTier: "VERIFIED" }),
      }),
    )
    delete process.env.SANDBOX_VETTING_ENABLED
  })

  it("skill approve with simulated report stays SCANNED when vetting env on", async () => {
    process.env.SANDBOX_VETTING_ENABLED = "true"
    const sim = JSON.stringify({
      version: 1,
      skillId: "sk-1",
      contentDigest: "b".repeat(64),
      passed: true,
      execution: "simulated",
      violations: [],
      dryChecks: { bins: [], envVars: [], credPathCanaries: [] },
      agentTurn: { model: "x", completed: false, summary: "AGENT_SKIPPED" },
      dockerImage: "e2e-local-grade",
      finishedAt: new Date().toISOString(),
    })
    prismaMock.marketplaceSkill.findUnique.mockResolvedValue({
      id: "sk-1",
      name: "S",
      slug: "s",
      reviewStatus: "PENDING",
      sandboxPassed: true,
      sandboxReport: sim,
      publishedAt: null,
      creator: { displayName: "C", user: { email: "c@test.com", name: "C" } },
    } as never)
    prismaMock.marketplaceSkill.update.mockResolvedValue({
      id: "sk-1",
      reviewStatus: "APPROVED",
      trustTier: "SCANNED",
      isPublished: true,
    } as never)

    const res = await approveSkill(
      createMockRequest("http://localhost/api/admin/review-queue/skills/sk-1/approve", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "sk-1" }) },
    )
    expect(res.status).toBe(200)
    expect(prismaMock.marketplaceSkill.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ trustTier: "SCANNED" }),
      }),
    )
    delete process.env.SANDBOX_VETTING_ENABLED
  })

  it("skill approve without sandbox refused when vetting env on", async () => {
    process.env.SANDBOX_VETTING_ENABLED = "true"
    prismaMock.marketplaceSkill.findUnique.mockResolvedValue({
      id: "sk-1",
      name: "S",
      slug: "s",
      reviewStatus: "PENDING",
      sandboxPassed: null,
      publishedAt: null,
      creator: { displayName: "C", user: { email: "c@test.com", name: "C" } },
    } as never)

    const res = await approveSkill(
      createMockRequest("http://localhost/api/admin/review-queue/skills/sk-1/approve", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "sk-1" }) },
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error?.code).toBe("SANDBOX_REQUIRED")
    expect(prismaMock.marketplaceSkill.update).not.toHaveBeenCalled()
    delete process.env.SANDBOX_VETTING_ENABLED
  })

  it("skill approve with sandboxPassed=false refused when vetting env on (PR-5)", async () => {
    process.env.SANDBOX_VETTING_ENABLED = "true"
    prismaMock.marketplaceSkill.findUnique.mockResolvedValue({
      id: "sk-1",
      name: "S",
      slug: "s",
      reviewStatus: "PENDING",
      sandboxPassed: false,
      publishedAt: null,
      creator: { displayName: "C", user: { email: "c@test.com", name: "C" } },
    } as never)

    const res = await approveSkill(
      createMockRequest("http://localhost/api/admin/review-queue/skills/sk-1/approve", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "sk-1" }) },
    )
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.error?.code).toBe("SANDBOX_REQUIRED")
    expect(prismaMock.marketplaceSkill.update).not.toHaveBeenCalled()
    delete process.env.SANDBOX_VETTING_ENABLED
  })

  it("skill-approve email exists with live store URL (B5)", () => {
    const skillApprove = readFileSync(
      join(ROOT, "src/app/api/admin/review-queue/skills/[id]/approve/route.ts"),
      "utf8",
    )
    const templateApprove = readFileSync(
      join(ROOT, "src/app/api/admin/review-queue/templates/[id]/approve/route.ts"),
      "utf8",
    )
    // RESEND HONESTY: raw getResend().emails.send is banned (wrapper checks
    // the SDK's resolved error field); approval emails go through sendEmail.
    expect(skillApprove).toContain("sendEmail({")
    expect(skillApprove).toContain("kind: 'skill_approved'")
    expect(skillApprove).toContain("https://app.buildclaws.ai/store/skills/${skill.slug}")
    expect(skillApprove).toContain("View in marketplace")
    expect(templateApprove).toContain("sendEmail({")
    expect(templateApprove).toContain("kind: 'template_approved'")
    expect(templateApprove).toContain("https://app.buildclaws.ai/store/${template.slug}")
    expect(templateApprove).toContain("View in marketplace")
  })
})
