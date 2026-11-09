import { afterEach, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { createMockRequest } from "@/test/helpers/mock-request"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

const mockGetSessionUser = vi.fn()
vi.mock("@/lib/api/auth", () => ({ getSessionUser: () => mockGetSessionUser() }))

import { POST } from "@/app/api/templates/[slug]/install/route"

const SNAPSHOT = {
  agents: [
    {
      agentSlug: "orch",
      name: "Orchestrator",
      role: "ORCHESTRATOR",
      model: "anthropic/claude-haiku-4-5-20251001",
      soulMd: "soul",
      agentsMd: "agents",
      color: "#5BA1F5",
      positionX: 0,
      positionY: 0,
    },
    {
      agentSlug: "worker",
      name: "Worker",
      role: "WORKER",
      model: "anthropic/claude-sonnet-4-6",
      soulMd: "soul2",
      agentsMd: "agents2",
      positionX: 100,
      positionY: 0,
    },
  ],
  connections: [{ sourceSlug: "orch", targetSlug: "worker", condition: "ON_COMPLETE" }],
}

const TEMPLATE = {
  id: "tpl-1",
  slug: "twitter-growth-machine",
  name: "Twitter/X Growth Machine",
  description: "A template",
  price: 49,
  isPublished: true,
  trustTier: "OFFICIAL",
  reviewStatus: "APPROVED",
  workspaceSnapshot: JSON.stringify(SNAPSHOT),
}

function setupCreate() {
  ;(prismaMock.$transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation(
    async (fn: (tx: typeof prismaMock) => Promise<unknown>) => fn(prismaMock),
  )
  ;(prismaMock.clawTemplate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: TEMPLATE.id,
    isPublished: true,
    trustTier: "OFFICIAL",
    reviewStatus: "APPROVED",
  })
  ;(prismaMock.clawTemplate.findUniqueOrThrow as ReturnType<typeof vi.fn>).mockResolvedValue(TEMPLATE)
  ;(prismaMock.workspace.count as ReturnType<typeof vi.fn>).mockImplementation(async () => {
    const calls = (prismaMock.workspace.count as ReturnType<typeof vi.fn>).mock.calls.length
    return calls <= 1 ? 0 : 1
  })
  ;(prismaMock.workspace.create as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "ws-1",
    name: TEMPLATE.name,
  })
  ;(prismaMock.agent.create as ReturnType<typeof vi.fn>)
    .mockResolvedValueOnce({ id: "agent-orch" })
    .mockResolvedValueOnce({ id: "agent-worker" })
  ;(prismaMock.agentConnection.create as ReturnType<typeof vi.fn>).mockResolvedValue({})
  ;(prismaMock.templateInstall.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "install-1" })
  ;(prismaMock.clawTemplate.update as ReturnType<typeof vi.fn>).mockResolvedValue({})
  ;(prismaMock.user.update as ReturnType<typeof vi.fn>).mockResolvedValue({})
}

function callInstall() {
  const req = createMockRequest("http://localhost:3000/api/templates/twitter-growth-machine/install", {
    method: "POST",
  })
  return POST(req, { params: Promise.resolve({ slug: "twitter-growth-machine" }) })
}

describe("POST /api/templates/[slug]/install", () => {
  afterEach(() => {
    delete process.env.CLAWS_PROFILE
  })

  it("self-host install creates the workspace with the template agent count and no Purchase row", async () => {
    process.env.CLAWS_PROFILE = "self-host"
    mockGetSessionUser.mockResolvedValue({ id: "user-1" })
    setupCreate()

    const res = await callInstall()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.data.redirectUrl).toBe("/setup/ws-1/step/1")
    expect(prismaMock.agent.create).toHaveBeenCalledTimes(SNAPSHOT.agents.length)
    expect(prismaMock.workspace.create).toHaveBeenCalledTimes(1)
    expect(prismaMock.purchase.create).not.toHaveBeenCalled()
  })

  it("hosted install route does not create a workspace", async () => {
    delete process.env.CLAWS_PROFILE
    mockGetSessionUser.mockResolvedValue({ id: "user-1" })
    const res = await callInstall()
    expect(res.status).toBe(404)
    expect(prismaMock.workspace.create).not.toHaveBeenCalled()
    expect(prismaMock.purchase.create).not.toHaveBeenCalled()
  })

  it("uses the same createWorkspaceFromTemplate the payment webhook uses", () => {
    const route = readFileSync(
      join(process.cwd(), "src/app/api/templates/[slug]/install/route.ts"),
      "utf8",
    )
    const webhook = readFileSync(
      join(process.cwd(), "src/app/api/dodo-payments/webhook/route.ts"),
      "utf8",
    )
    expect(route).toContain("createWorkspaceFromTemplate")
    expect(webhook).toContain("createWorkspaceFromTemplate")
    expect(route).not.toContain("purchase.create")
  })
})
