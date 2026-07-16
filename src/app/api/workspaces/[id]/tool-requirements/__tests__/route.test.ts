import { beforeEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { createMockRequest, parseResponse } from "@/test/helpers/mock-request"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))
vi.mock("@/lib/api/auth", () => ({
  getSessionUser: vi.fn().mockResolvedValue({ id: "user-1", email: "u@test.com" }),
}))
vi.mock("@/lib/api/ownership", () => ({
  verifyWorkspaceOwnership: vi
    .fn()
    .mockResolvedValue({ error: null, workspace: { id: "ws-1", userId: "user-1" } }),
}))

import { GET, PATCH } from "@/app/api/workspaces/[id]/tool-requirements/route"

const TOOLS = [
  {
    slug: "anthropic_api",
    name: "Anthropic (Claude)",
    category: "AI",
    connectionType: "API_KEY",
    required: true,
  },
  {
    slug: "twitter-api",
    name: "Twitter/X API",
    category: "Social",
    connectionType: "API_KEY",
    required: true,
  },
  {
    slug: "tavily",
    name: "Tavily",
    category: "Research",
    connectionType: "API_KEY",
    required: false,
  },
]

const TEMPLATE_SNAPSHOT = JSON.stringify({ agents: [], tools: TOOLS })

const params = (id = "ws-1") => ({ params: Promise.resolve({ id }) })

function mockWorkspaceResolve(toolRequirements: unknown) {
  ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
    toolRequirements,
    clawTemplateId: "tpl-1",
    clawTemplate: {
      id: "tpl-1",
      slug: "twitter-growth-machine",
      workspaceSnapshot: TEMPLATE_SNAPSHOT,
    },
  })
  ;(prismaMock.clawTemplate.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
    workspaceSnapshot: TEMPLATE_SNAPSHOT,
  })
  ;(prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockImplementation(
    async ({ data }: { data: { toolRequirements: unknown } }) => ({
      id: "ws-1",
      toolRequirements: data.toolRequirements,
    }),
  )
}

beforeEach(async () => {
  const { getSessionUser } = await import("@/lib/api/auth")
  ;(getSessionUser as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "user-1",
    email: "u@test.com",
  })
  const { verifyWorkspaceOwnership } = await import("@/lib/api/ownership")
  ;(verifyWorkspaceOwnership as ReturnType<typeof vi.fn>).mockResolvedValue({
    error: null,
    workspace: { id: "ws-1", userId: "user-1" },
  })
  mockWorkspaceResolve(TOOLS)
})

describe("GET /api/workspaces/[id]/tool-requirements", () => {
  it("401 when unauthenticated", async () => {
    const { getSessionUser } = await import("@/lib/api/auth")
    ;(getSessionUser as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)
    const res = await GET(
      createMockRequest("http://localhost/api/workspaces/ws-1/tool-requirements"),
      params(),
    )
    expect(res.status).toBe(401)
  })

  it("returns partitioned required/recommended from workspace set", async () => {
    const res = await GET(
      createMockRequest("http://localhost/api/workspaces/ws-1/tool-requirements"),
      params(),
    )
    const { status, data } = await parseResponse(res)
    expect(status).toBe(200)
    expect(data.data.source).toBe("workspace")
    expect(data.data.required.map((t: { slug: string }) => t.slug)).toEqual([
      "anthropic_api",
      "twitter-api",
    ])
    expect(data.data.recommended.map((t: { slug: string }) => t.slug)).toEqual(["tavily"])
  })

  it("excludes dismissed from recommended", async () => {
    mockWorkspaceResolve([
      ...TOOLS.filter((t) => t.slug !== "tavily"),
      { ...TOOLS[2], dismissed: true },
    ])
    const res = await GET(
      createMockRequest("http://localhost/api/workspaces/ws-1/tool-requirements"),
      params(),
    )
    const { data } = await parseResponse(res)
    expect(data.data.recommended.map((t: { slug: string }) => t.slug)).toEqual([])
  })
})

describe("PATCH /api/workspaces/[id]/tool-requirements", () => {
  it("demotes twitter and persists workspace JSON", async () => {
    const res = await PATCH(
      createMockRequest("http://localhost/api/workspaces/ws-1/tool-requirements", {
        method: "PATCH",
        body: { op: "demote", slug: "twitter-api" },
      }),
      params(),
    )
    const { status, data } = await parseResponse(res)
    expect(status).toBe(200)
    expect(
      data.data.required.find((t: { slug: string }) => t.slug === "twitter-api"),
    ).toBeUndefined()
    expect(prismaMock.workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "ws-1" },
        data: expect.objectContaining({
          toolRequirements: expect.arrayContaining([
            expect.objectContaining({ slug: "twitter-api", required: false }),
          ]),
        }),
      }),
    )
  })

  it("dismiss persists and excludes from recommended", async () => {
    const res = await PATCH(
      createMockRequest("http://localhost/api/workspaces/ws-1/tool-requirements", {
        method: "PATCH",
        body: { op: "dismiss", slug: "tavily" },
      }),
      params(),
    )
    const { status, data } = await parseResponse(res)
    expect(status).toBe(200)
    expect(data.data.recommended.map((t: { slug: string }) => t.slug)).not.toContain("tavily")
    expect(prismaMock.workspace.update).toHaveBeenCalled()
  })

  it("restore re-hydrates from template defaults", async () => {
    mockWorkspaceResolve(
      TOOLS.map((t) =>
        t.slug === "twitter-api" ? { ...t, required: false, dismissed: true } : t,
      ),
    )
    const res = await PATCH(
      createMockRequest("http://localhost/api/workspaces/ws-1/tool-requirements", {
        method: "PATCH",
        body: { op: "restore", slug: "twitter-api" },
      }),
      params(),
    )
    const { status, data } = await parseResponse(res)
    expect(status).toBe(200)
    expect(
      data.data.required.find((t: { slug: string }) => t.slug === "twitter-api"),
    ).toBeTruthy()
  })

  it("remove drops slug and does NOT touch ToolConnection", async () => {
    const res = await PATCH(
      createMockRequest("http://localhost/api/workspaces/ws-1/tool-requirements", {
        method: "PATCH",
        body: { op: "remove", slug: "twitter-api" },
      }),
      params(),
    )
    const { status, data } = await parseResponse(res)
    expect(status).toBe(200)
    expect(data.data.tools.find((t: { slug: string }) => t.slug === "twitter-api")).toBeUndefined()
    expect(prismaMock.toolConnection.delete).not.toHaveBeenCalled()
    expect(prismaMock.toolConnection.deleteMany).not.toHaveBeenCalled()
    expect(prismaMock.toolConnection.update).not.toHaveBeenCalled()
  })

  it("AI-provider PATCH → 4xx", async () => {
    const res = await PATCH(
      createMockRequest("http://localhost/api/workspaces/ws-1/tool-requirements", {
        method: "PATCH",
        body: { op: "demote", slug: "anthropic_api" },
      }),
      params(),
    )
    const { status, data } = await parseResponse(res)
    expect(status).toBe(400)
    expect(data.error.code).toBe("AI_PROVIDER_NOT_CUSTOMIZABLE")
    expect(prismaMock.workspace.update).not.toHaveBeenCalled()
  })

  it("403 when not owner", async () => {
    const { verifyWorkspaceOwnership } = await import("@/lib/api/ownership")
    ;(verifyWorkspaceOwnership as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      error: "FORBIDDEN",
      workspace: null,
    })
    const res = await PATCH(
      createMockRequest("http://localhost/api/workspaces/ws-1/tool-requirements", {
        method: "PATCH",
        body: { op: "demote", slug: "twitter-api" },
      }),
      params(),
    )
    expect(res.status).toBe(403)
  })
})
