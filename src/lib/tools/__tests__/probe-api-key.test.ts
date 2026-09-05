import { beforeEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

const mockDecrypt = vi.fn((v: string) => v)
vi.mock("@/lib/encryption", () => ({
  decrypt: (v: string) => mockDecrypt(v),
}))

vi.mock("@/lib/logger", () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), toolEvent: vi.fn() },
}))

const mockHasValidator = vi.fn()
const mockValidateToolKey = vi.fn()
vi.mock("@/lib/tools/validators", () => ({
  hasValidator: (slug: string) => mockHasValidator(slug),
  validateToolKey: (...args: unknown[]) => mockValidateToolKey(...args),
}))

import {
  TOOL_STATUS_REPROBE_EVENT_KIND,
  ledgerToolStatusProbe,
  probeAndPersistApiKeyConnection,
} from "@/lib/tools/probe-api-key"

const CONN = {
  id: "conn-1",
  workspaceId: "ws-1",
  toolSlug: "tavily",
  connectionType: "API_KEY",
  status: "PENDING",
  encryptedCredentials: JSON.stringify({ TAVILY_API_KEY: "tvly-test" }),
}

describe("probeAndPersistApiKeyConnection", () => {
  beforeEach(() => {
    mockDecrypt.mockImplementation((v: string) => v)
    mockHasValidator.mockReturnValue(true)
    mockValidateToolKey.mockReset()
    ;(prismaMock.toolConnection.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "CONNECTED",
    })
    ;(prismaMock.activityLog.create as ReturnType<typeof vi.fn>).mockResolvedValue({ id: "log-1" })
  })

  it("marks CONNECTED on a valid probe", async () => {
    mockValidateToolKey.mockResolvedValue({ valid: true })
    const out = await probeAndPersistApiKeyConnection(CONN, { userId: "u1" })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.result.outcome).toBe("connected")
    expect(prismaMock.toolConnection.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "CONNECTED", lastError: null }),
      }),
    )
  })

  it("leaves status unchanged when no validator exists", async () => {
    mockHasValidator.mockReturnValue(false)
    const out = await probeAndPersistApiKeyConnection(CONN)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.result.outcome).toBe("unverified")
    expect(out.result.status).toBe("PENDING")
    expect(prismaMock.toolConnection.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { lastTestedAt: expect.any(Date) },
      }),
    )
  })

  it("rejects NEEDS_CREDENTIALS without writing status", async () => {
    const out = await probeAndPersistApiKeyConnection({
      ...CONN,
      status: "NEEDS_CREDENTIALS",
    })
    expect(out.ok).toBe(false)
    if (out.ok) return
    expect(out.failure.kind).toBe("needs_credentials")
    expect(prismaMock.toolConnection.update).not.toHaveBeenCalled()
  })

  it("ledgers user-request probes", async () => {
    await ledgerToolStatusProbe({
      workspaceId: "ws-1",
      trigger: "user_request",
      results: [{ toolSlug: "tavily", outcome: "connected", status: "CONNECTED" }],
    })
    expect(prismaMock.activityLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "Tool status re-probed on user request",
        actionType: "SYSTEM",
        metadata: expect.stringContaining(TOOL_STATUS_REPROBE_EVENT_KIND),
      }),
    })
  })
})
