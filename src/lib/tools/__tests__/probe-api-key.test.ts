import { readFileSync } from "node:fs"
import { join } from "node:path"
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
  SEP9_HEALTHY_TOKEN_TRANSIENT,
  TOOL_STATUS_REPROBE_EVENT_KIND,
  isDefinitiveAuthProbeFailure,
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

  it("429 warning keeps prior status and is a silent retry", async () => {
    mockValidateToolKey.mockResolvedValue({
      valid: true,
      warning: "Couldn't verify right now - the provider rate-limited the check.",
    })
    const out = await probeAndPersistApiKeyConnection({ ...CONN, status: "CONNECTED" })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.result.outcome).toBe("retry")
    expect(out.result.status).toBe("CONNECTED")
    expect(prismaMock.toolConnection.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { lastTestedAt: expect.any(Date) },
      }),
    )
  })

  it("timeout on a healthy token is retry, not ERROR (Sep-9 fixture)", async () => {
    mockValidateToolKey.mockResolvedValue({
      valid: false,
      error: SEP9_HEALTHY_TOKEN_TRANSIENT,
    })
    const out = await probeAndPersistApiKeyConnection({ ...CONN, status: "CONNECTED" })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.result.outcome).toBe("retry")
    expect(out.result.status).toBe("CONNECTED")
    expect(out.result.error).toBe(SEP9_HEALTHY_TOKEN_TRANSIENT)
    expect(isDefinitiveAuthProbeFailure({ valid: false, error: SEP9_HEALTHY_TOKEN_TRANSIENT })).toBe(false)
    const statusWrites = (prismaMock.toolConnection.update as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call) => (call[0] as { data?: { status?: string } })?.data?.status === "ERROR",
    )
    expect(statusWrites).toHaveLength(0)
  })

  it("401 Invalid Bearer is ERROR", async () => {
    mockValidateToolKey.mockResolvedValue({
      valid: false,
      error: "Invalid Twitter/X Bearer token",
    })
    ;(prismaMock.toolConnection.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "ERROR",
    })
    const out = await probeAndPersistApiKeyConnection({
      ...CONN,
      toolSlug: "twitter-api",
      status: "CONNECTED",
    })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.result.outcome).toBe("error")
    expect(out.result.status).toBe("ERROR")
  })

  it("MUTATION: non-auth invalid must not flip ERROR (timeout → ERROR fails)", async () => {
    const src = readFileSync(join(process.cwd(), "src/lib/tools/probe-api-key.ts"), "utf8")
    expect(src).toContain("isDefinitiveAuthProbeFailure")
    expect(src).toContain('outcome: "retry"')
    expect(src).toContain("SEP9_HEALTHY_TOKEN_TRANSIENT")
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
