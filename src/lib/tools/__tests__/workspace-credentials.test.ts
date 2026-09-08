import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

const mockDecrypt = vi.fn((value: string) => value)
vi.mock("@/lib/encryption", () => ({
  decrypt: (value: string) => mockDecrypt(value),
}))

import { resolveWorkspaceToolCredentials } from "@/lib/tools/workspace-credentials"

const RIG_WS = "ws-rig-fire-3"
const FOUNDER_WS = "ws-founder-forbidden"
const FOUNDER_CIPHER = JSON.stringify({ TWITTER_API_KEY: "founder-bearer-must-not-leak" })

describe("resolveWorkspaceToolCredentials", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockDecrypt.mockImplementation((value: string) => value)
  })

  it("queries by workspaceId + toolSlug only and returns that row", async () => {
    ;(prismaMock.toolConnection.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      encryptedCredentials: JSON.stringify({ ALPACA_API_KEY_ID: "PK-rig" }),
    })
    const got = await resolveWorkspaceToolCredentials(RIG_WS, "alpaca")
    expect(got).toEqual({ ALPACA_API_KEY_ID: "PK-rig" })
    expect(prismaMock.toolConnection.findFirst).toHaveBeenCalledTimes(1)
    expect(prismaMock.toolConnection.findFirst).toHaveBeenCalledWith({
      where: { workspaceId: RIG_WS, toolSlug: "alpaca" },
      select: { encryptedCredentials: true },
    })
  })

  it("returns null when the workspace has no row (never reads another workspace)", async () => {
    ;(prismaMock.toolConnection.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    const got = await resolveWorkspaceToolCredentials(RIG_WS, "twitter-api")
    expect(got).toBeNull()
    expect(prismaMock.toolConnection.findFirst).toHaveBeenCalledWith({
      where: { workspaceId: RIG_WS, toolSlug: "twitter-api" },
      select: { encryptedCredentials: true },
    })
    expect(prismaMock.toolConnection.findMany).not.toHaveBeenCalled()
    expect(mockDecrypt).not.toHaveBeenCalledWith(FOUNDER_CIPHER)
  })

  it("throws when workspaceId is missing so a slug-only lookup cannot compile", async () => {
    await expect(resolveWorkspaceToolCredentials("", "twitter-api")).rejects.toThrow("workspaceId is required")
    expect(prismaMock.toolConnection.findFirst).not.toHaveBeenCalled()
  })

  it("MUTATION: implementation stays workspace-scoped", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/tools/workspace-credentials.ts"), "utf8")
    expect(src).toMatch(/where:\s*\{\s*workspaceId,\s*toolSlug\s*\}/)
    expect(src).not.toMatch(/workspaceId:\s*\{\s*in:/)
    expect(src).not.toMatch(/OR:\s*\[/)
    expect(src).not.toMatch(/findMany/)
    expect(src).not.toContain(FOUNDER_WS)
    expect(src).not.toContain("cmtfb3a9k000004l9df96h5wd")
    expect(src).not.toContain("cmr3fo19r000404jlze8o7dm8")
  })
})
