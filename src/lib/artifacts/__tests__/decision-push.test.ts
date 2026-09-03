import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"

const mockGw = vi.hoisted(() => vi.fn())
const mockSend = vi.hoisted(() => vi.fn())
const mockWake = vi.hoisted(() => vi.fn())
const mockFlush = vi.hoisted(() => vi.fn())
const mockLedger = vi.hoisted(() => vi.fn())

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))
vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock("@/lib/openclaw/deployer", () => ({
  getGatewayConnectionInfo: (...args: unknown[]) => mockGw(...args),
}))
vi.mock("@/lib/openclaw/gateway-chat-client", () => ({
  sendChatMessage: (...args: unknown[]) => mockSend(...args),
}))
vi.mock("@/lib/hibernation/manager", () => ({
  wakeWorkspace: (...args: unknown[]) => mockWake(...args),
}))
vi.mock("@/lib/openclaw/chat-send-hold", async (orig) => {
  const actual = await orig<typeof import("@/lib/openclaw/chat-send-hold")>()
  return {
    ...actual,
    ledgerChatSendHeld: (...args: unknown[]) => mockLedger(...args),
    flushHeldChatSends: (...args: unknown[]) => mockFlush(...args),
  }
})
vi.mock("@/lib/openclaw/device-identity", () => ({
  decryptDeviceIdentity: vi.fn(() => ({ deviceId: "dev", publicKeyRawB64u: "pk", privateKeyPem: "sk" })),
  encryptDeviceIdentity: vi.fn(() => "enc"),
  generateDeviceIdentity: vi.fn(() => ({ deviceId: "dev", publicKeyRawB64u: "pk", privateKeyPem: "sk" })),
}))

import {
  __setDecisionPushDepsForTests,
  formatDecisionPushLine,
  formatDecisionPushMessage,
  pushDecisionToClaw,
} from "@/lib/artifacts/decision-push"

describe("formatDecisionPushLine", () => {
  it("matches the human-decision receipt line", () => {
    expect(
      formatDecisionPushLine({
        logicalPath: "shared/deliverables/x-content-cycle.md",
        version: 2,
        decision: "APPROVED",
        at: new Date("2026-09-02T19:34:00.000Z"),
      }),
    ).toBe("Human decision: x-content-cycle v2 APPROVED at 19:34Z")
  })
})

describe("formatDecisionPushMessage", () => {
  it("points the agent at the sidecar and forbids a mission", () => {
    const body = formatDecisionPushMessage({
      logicalPath: "shared/deliverables/x-content-cycle.md",
      version: 2,
      decision: "APPROVED",
      at: new Date("2026-09-02T19:34:00.000Z"),
    })
    expect(body).toContain("Human decision: x-content-cycle v2 APPROVED at 19:34Z")
    expect(body).toContain("shared/deliverables/x-content-cycle.md.status.json")
    expect(body).toContain("source of truth")
    expect(body).toContain("Relabel HELD/QUEUED")
    expect(body).toContain("memory line")
    expect(body).toContain("ack line")
    expect(body).toContain("Do not start a mission")
    expect(body).not.toContain("HEARTBEAT")
    expect(body).not.toContain("Resume the interrupted mission")
  })
})

describe("pushDecisionToClaw", () => {
  const scheduled: Array<() => unknown> = []

  beforeEach(() => {
    scheduled.length = 0
    mockGw.mockReset()
    mockSend.mockReset()
    mockWake.mockReset()
    mockFlush.mockReset()
    mockLedger.mockReset()
    mockGw.mockResolvedValue({ wsUrl: "wss://claw.example", token: "gw" })
    mockSend.mockResolvedValue({ ok: true, runId: "run-1", status: "started", paired: false })
    mockWake.mockResolvedValue(undefined)
    mockFlush.mockResolvedValue({ flushed: 1, failed: 0 })
    mockLedger.mockResolvedValue(undefined)
    __setDecisionPushDepsForTests({
      send: mockSend,
      schedule: (fn) => {
        scheduled.push(fn)
      },
      wake: mockWake,
      flushHeld: mockFlush,
    })
    ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "RUNNING",
      containerHost: "claw.example",
      gatewayToken: "tok",
      chatDeviceKeyEncrypted: "enc",
    })
    ;(prismaMock.agent.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      agentSlug: "twitter-commander",
    })
  })

  it("RUNNING schedules a lightweight owner turn (not a mission)", async () => {
    const result = await pushDecisionToClaw({
      workspaceId: "ws-1",
      logicalPath: "shared/deliverables/x-content-cycle.md",
      version: 2,
      decision: "APPROVED",
      at: new Date("2026-09-02T19:34:00.000Z"),
    })
    expect(result.pushed).toBe(true)
    expect(result.held).toBe(false)
    expect(mockSend).not.toHaveBeenCalled()
    expect(scheduled).toHaveLength(1)
    await scheduled[0]!()
    expect(mockSend).toHaveBeenCalledTimes(1)
    const sent = mockSend.mock.calls[0]![0] as { message: string; sessionKey: string; idempotencyKey: string }
    expect(sent.sessionKey).toBe("agent:twitter-commander:main")
    expect(sent.idempotencyKey).toBe(result.runId)
    expect(sent.message).toContain("Human decision: x-content-cycle v2 APPROVED at 19:34Z")
    expect(sent.message).not.toContain("Resume the interrupted mission")
    expect(mockLedger).not.toHaveBeenCalled()
  })

  it("HIBERNATED queues via held-flush and wakes", async () => {
    ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      status: "HIBERNATED",
      containerHost: null,
      gatewayToken: null,
      chatDeviceKeyEncrypted: null,
    })
    const result = await pushDecisionToClaw({
      workspaceId: "ws-1",
      logicalPath: "shared/deliverables/x-content-cycle.md",
      version: 2,
      decision: "REJECTED",
    })
    expect(result).toMatchObject({ pushed: true, held: true })
    expect(mockLedger).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        holdReason: "HIBERNATED",
        runId: result.runId,
      }),
    )
    expect(mockSend).not.toHaveBeenCalled()
    expect(scheduled).toHaveLength(0)
    expect(mockWake).toHaveBeenCalledWith("ws-1")
  })

  it("MUTATION: never resumes a mission window", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/artifacts/decision-push.ts"), "utf8")
    expect(src).not.toContain("maybeResumeInterruptedMission")
    expect(src).not.toContain("MISSION_RESUME_PROMPT")
    expect(src).not.toContain("HEARTBEAT")
    expect(src).toContain("ledgerChatSendHeld")
    expect(src).toContain("sendChatMessage")
  })
})
