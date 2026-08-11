import { beforeEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { createMockRequest, parseResponse } from "@/test/helpers/mock-request"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

const mockGetSessionUser = vi.fn()
vi.mock("@/lib/api/auth", () => ({ getSessionUser: () => mockGetSessionUser() }))

const mockVerifyOwnership = vi.fn()
vi.mock("@/lib/api/ownership", () => ({
  verifyWorkspaceOwnership: (...args: unknown[]) => mockVerifyOwnership(...args),
}))

vi.mock("@/lib/encryption", () => ({
  encrypt: (plaintext: string) => `enc:${plaintext}`,
  decrypt: (blob: string) => blob.replace(/^enc:/, ""),
}))

import { DELETE, GET, POST } from "@/app/api/channels/[workspaceId]/route"

const telegramConfig = {
  telegram: { botToken: "123456789:telegram-secret-token" },
}

function req(method: "GET" | "POST" | "DELETE", body?: unknown) {
  return createMockRequest("http://localhost:3000/api/channels/ws-1", { method, body })
}

function ownedWorkspace(channelConfigEncrypted: string | null = null) {
  return {
    id: "ws-1",
    userId: "user-1",
    channelConfigEncrypted,
  }
}

describe("/api/channels/[workspaceId]", () => {
  beforeEach(() => {
    mockGetSessionUser.mockResolvedValue({ id: "user-1" })
    mockVerifyOwnership.mockResolvedValue({ error: null, workspace: ownedWorkspace() })
  })

  it("returns 401 when unauthenticated", async () => {
    mockGetSessionUser.mockResolvedValue(null)

    const res = await GET(req("GET"), { params: Promise.resolve({ workspaceId: "ws-1" }) })

    expect(res.status).toBe(401)
    expect(mockVerifyOwnership).not.toHaveBeenCalled()
  })

  it("rejects invalid channel payload before encrypting", async () => {
    const res = await POST(
      req("POST", { channel: "telegram", config: { token: "wrong-field" } }),
      { params: Promise.resolve({ workspaceId: "ws-1" }) },
    )
    const { status, data } = await parseResponse(res)

    expect(status).toBe(400)
    expect(data.error.code).toBe("VALIDATION_ERROR")
    expect(prismaMock.workspace.update).not.toHaveBeenCalled()
  })

  it("encrypts canonical Telegram config and GET returns only masked presence", async () => {
    ;(prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      channelConfigEncrypted: `enc:${JSON.stringify(telegramConfig)}`,
    })

    const postRes = await POST(
      req("POST", { channel: "telegram", config: { botToken: "123456789:telegram-secret-token" } }),
      { params: Promise.resolve({ workspaceId: "ws-1" }) },
    )
    const post = await postRes.json()

    expect(postRes.status).toBe(200)
    expect(prismaMock.workspace.update).toHaveBeenCalledWith({
      where: { id: "ws-1" },
      data: { channelConfigEncrypted: `enc:${JSON.stringify(telegramConfig)}` },
      select: { channelConfigEncrypted: true },
    })
    expect(post.data.channels.telegram.fields.botToken).toBe("1234...oken")
    expect(JSON.stringify(post.data)).not.toContain("telegram-secret-token")

    mockVerifyOwnership.mockResolvedValue({
      error: null,
      workspace: ownedWorkspace(`enc:${JSON.stringify(telegramConfig)}`),
    })
    const getRes = await GET(req("GET"), { params: Promise.resolve({ workspaceId: "ws-1" }) })
    const get = await getRes.json()

    expect(get.data.configuredChannelIds).toEqual(["telegram"])
    expect(get.data.hasConfiguredChannels).toBe(true)
    expect(JSON.stringify(get.data)).not.toContain("telegram-secret-token")
  })

  it("merges allowFrom without overwriting stored channel secrets", async () => {
    mockVerifyOwnership.mockResolvedValue({
      error: null,
      workspace: ownedWorkspace(`enc:${JSON.stringify(telegramConfig)}`),
    })
    ;(prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      channelConfigEncrypted: `enc:${JSON.stringify({
        telegram: {
          botToken: "123456789:telegram-secret-token",
          allowFrom: ["424242"],
        },
      })}`,
    })

    const res = await POST(
      req("POST", { channel: "telegram", config: { allowFrom: ["424242"] } }),
      { params: Promise.resolve({ workspaceId: "ws-1" }) },
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(prismaMock.workspace.update).toHaveBeenCalledWith({
      where: { id: "ws-1" },
      data: {
        channelConfigEncrypted: `enc:${JSON.stringify({
          telegram: {
            botToken: "123456789:telegram-secret-token",
            allowFrom: ["424242"],
          },
        })}`,
      },
      select: { channelConfigEncrypted: true },
    })
    expect(json.data.channels.telegram.allowedIds).toEqual(["424242"])
    expect(JSON.stringify(json.data)).not.toContain("telegram-secret-token")
  })

  it("DELETE removes one channel and clears the blob when no channels remain", async () => {
    mockVerifyOwnership.mockResolvedValue({
      error: null,
      workspace: ownedWorkspace(`enc:${JSON.stringify(telegramConfig)}`),
    })
    ;(prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      channelConfigEncrypted: null,
    })

    const res = await DELETE(
      req("DELETE", { channel: "telegram" }),
      { params: Promise.resolve({ workspaceId: "ws-1" }) },
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(prismaMock.workspace.update).toHaveBeenCalledWith({
      where: { id: "ws-1" },
      data: { channelConfigEncrypted: null },
      select: { channelConfigEncrypted: true },
    })
    expect(json.data.hasConfiguredChannels).toBe(false)
  })

  it("POST connect sets hasActiveChannels and RUNNING→WARM", async () => {
    ;(prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      channelConfigEncrypted: `enc:${JSON.stringify(telegramConfig)}`,
    })
    const updateMany = prismaMock.containerState.updateMany as ReturnType<typeof vi.fn>
    updateMany.mockResolvedValue({ count: 1 })

    const res = await POST(
      req("POST", { channel: "telegram", config: { botToken: "123456789:telegram-secret-token" } }),
      { params: Promise.resolve({ workspaceId: "ws-1" }) },
    )
    expect(res.status).toBe(200)

    expect(updateMany).toHaveBeenCalledWith({
      where: { workspaceId: "ws-1" },
      data: { hasActiveChannels: true },
    })
    expect(updateMany).toHaveBeenCalledWith({
      where: { workspaceId: "ws-1", containerPhase: "RUNNING" },
      data: { containerPhase: "WARM" },
    })
  })

  it("DELETE last channel clears hasActiveChannels and WARM→RUNNING", async () => {
    mockVerifyOwnership.mockResolvedValue({
      error: null,
      workspace: ownedWorkspace(`enc:${JSON.stringify(telegramConfig)}`),
    })
    ;(prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      channelConfigEncrypted: null,
    })
    const updateMany = prismaMock.containerState.updateMany as ReturnType<typeof vi.fn>
    updateMany.mockResolvedValue({ count: 1 })

    const res = await DELETE(
      req("DELETE", { channel: "telegram" }),
      { params: Promise.resolve({ workspaceId: "ws-1" }) },
    )
    expect(res.status).toBe(200)

    expect(updateMany).toHaveBeenCalledWith({
      where: { workspaceId: "ws-1" },
      data: {
        hasActiveChannels: false,
        channelsConnectedAt: null,
      },
    })
    expect(updateMany).toHaveBeenCalledWith({
      where: { workspaceId: "ws-1", containerPhase: "WARM" },
      data: { containerPhase: "RUNNING" },
    })
  })

  it("MUTATION: connect path without RUNNING→WARM flip fails", async () => {
    const { readFileSync } = await import("node:fs")
    const { join } = await import("node:path")
    const src = readFileSync(
      join(process.cwd(), "src/app/api/channels/[workspaceId]/route.ts"),
      "utf8",
    )
    expect(src).toContain('containerPhase: "RUNNING"')
    expect(src).toContain('containerPhase: "WARM"')
    // Must gate the flip on current RUNNING (not blind overwrite).
    expect(src).toMatch(/where:\s*\{\s*workspaceId,\s*containerPhase:\s*"RUNNING"/)
  })
})
