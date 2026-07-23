import { beforeEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { readFileSync } from "node:fs"
import { join } from "node:path"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))
vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock("@/lib/encryption", () => ({
  decrypt: (encoded: string) => `sk-ant-plain-${encoded}`,
}))

import { convertUserToByok } from "@/lib/credits/byok-recovery"
import { deriveContainerEnv } from "@/lib/openclaw/derive-container-env"

describe("convertUserToByok — BYOK recovery contract", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(prismaMock.user.update as ReturnType<typeof vi.fn>).mockResolvedValue({} as never)
    ;(prismaMock.creditAccount.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({
      count: 1,
    } as never)
    ;(prismaMock.workspace.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({
      count: 1,
    } as never)
  })

  it("flips USER_OWN_KEY + converts ACTIVE|EXHAUSTED + rearms STOPPED+HIBERNATED phase", async () => {
    const result = await convertUserToByok("user-1")
    expect(result.switched).toBe(true)
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { apiKeySource: "USER_OWN_KEY" },
    })
    expect(prismaMock.creditAccount.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", status: { in: ["ACTIVE", "EXHAUSTED"] } },
      data: { status: "CONVERTED" },
    })
    expect(prismaMock.workspace.updateMany).toHaveBeenCalledWith({
      where: {
        userId: "user-1",
        status: "STOPPED",
        containerState: { containerPhase: "HIBERNATED" },
      },
      data: { status: "HIBERNATED" },
    })
  })

  it("after recovery, deriveContainerEnv emits user key not master", () => {
    const prev = process.env.CLAWS_MASTER_ANTHROPIC_KEY
    process.env.CLAWS_MASTER_ANTHROPIC_KEY = "sk-ant-master-platform-key"
    try {
      const env = deriveContainerEnv(
        { apiKeySourceOverride: null },
        {
          apiKeySource: "USER_OWN_KEY",
          apiKeys: [{ provider: "ANTHROPIC", encryptedKey: "ENC_USER" }],
        },
      )
      expect(env.CLAWS_CREDIT_MODE).toBe(false)
      expect(env.ANTHROPIC_API_KEY).toBe("sk-ant-plain-ENC_USER")
      expect(env.ANTHROPIC_API_KEY).not.toBe("sk-ant-master-platform-key")
    } finally {
      if (prev === undefined) delete process.env.CLAWS_MASTER_ANTHROPIC_KEY
      else process.env.CLAWS_MASTER_ANTHROPIC_KEY = prev
    }
  })

  it("MUTATION: switch-source must call convertUserToByok (ACTIVE-only CONVERTED → fail)", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/api/api-keys/switch-source/route.ts"),
      "utf8",
    )
    expect(src).toContain("convertUserToByok")
    expect(src).not.toMatch(/where:\s*\{\s*userId,\s*status:\s*"ACTIVE"\s*\}/)
  })

  it("MUTATION: api-keys POST must auto-recover on EXHAUSTED Anthropic save", () => {
    const src = readFileSync(join(process.cwd(), "src/app/api/api-keys/route.ts"), "utf8")
    expect(src).toContain("maybeRecoverByokAfterAnthropicSave")
    expect(src).toContain("convertUserToByok")
    expect(src).toContain('status !== "EXHAUSTED"')
  })

  it("MUTATION: exhaustion email CTA must be settings?tab=api-keys", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/credits/exhaustion.ts"), "utf8")
    expect(src).toContain("settings?tab=api-keys")
    expect(src).not.toContain('href="https://app.buildclaws.ai/settings/api-keys"')
  })

  it("MUTATION: ApiKeyManager shows Switch when EXHAUSTED", () => {
    const src = readFileSync(
      join(process.cwd(), "src/components/settings/api-key-manager.tsx"),
      "utf8",
    )
    expect(src).toContain('credit.status === "EXHAUSTED"')
    expect(src).toContain("Switch to my key")
  })
})
