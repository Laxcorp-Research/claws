import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"

const mockGw = vi.hoisted(() => vi.fn())
const mockSend = vi.hoisted(() => vi.fn())

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
vi.mock("@/lib/openclaw/device-identity", () => ({
  decryptDeviceIdentity: vi.fn(() => ({ id: "dev", publicKey: "pk", privateKey: "sk" })),
  encryptDeviceIdentity: vi.fn(() => "enc"),
  generateDeviceIdentity: vi.fn(() => ({ id: "dev", publicKey: "pk", privateKey: "sk" })),
}))

import {
  CHAT_SEND_HELD_ACTION,
  CHAT_SEND_HELD_EVENT_KIND,
  flushHeldChatSends,
  heldFlushOwnerMessage,
  isHoldableChatStatus,
  ledgerChatSendHeld,
} from "@/lib/openclaw/chat-send-hold"

describe("isHoldableChatStatus", () => {
  it("holds boot and sleep, not stopped or running", () => {
    expect(isHoldableChatStatus("HIBERNATED")).toBe(true)
    expect(isHoldableChatStatus("WAKING")).toBe(true)
    expect(isHoldableChatStatus("DEPLOYING")).toBe(true)
    expect(isHoldableChatStatus("PROVISIONING_QUEUED")).toBe(true)
    expect(isHoldableChatStatus("RUNNING")).toBe(false)
    expect(isHoldableChatStatus("STOPPED")).toBe(false)
    expect(isHoldableChatStatus("DRAFT")).toBe(false)
  })
})

describe("ledgerChatSendHeld", () => {
  it("writes SYSTEM chat_send_held with the user text and runId", async () => {
    await ledgerChatSendHeld({
      workspaceId: "ws-1",
      message: "do the thing",
      runId: "run-hold",
      holdReason: "DEPLOYING",
    })
    expect(prismaMock.activityLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workspaceId: "ws-1",
        action: CHAT_SEND_HELD_ACTION,
        actionType: "SYSTEM",
        detail: "do the thing",
        metadata: expect.stringContaining(CHAT_SEND_HELD_EVENT_KIND),
      }),
    })
    const meta = JSON.parse(
      (prismaMock.activityLog.create as ReturnType<typeof vi.fn>).mock.calls[0][0].data.metadata,
    )
    expect(meta).toMatchObject({
      eventKind: CHAT_SEND_HELD_EVENT_KIND,
      holdStatus: "held",
      holdReason: "DEPLOYING",
      runId: "run-hold",
    })
  })
})

describe("flushHeldChatSends", () => {
  beforeEach(() => {
    mockGw.mockReset()
    mockSend.mockReset()
    mockGw.mockResolvedValue({ wsUrl: "wss://claw.example", token: "gw" })
    mockSend.mockResolvedValue({ ok: true, runId: "run-hold" })
    ;(prismaMock.activityLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "hold-1",
        detail: "do the thing",
        metadata: JSON.stringify({
          eventKind: CHAT_SEND_HELD_EVENT_KIND,
          holdStatus: "held",
          runId: "run-hold",
        }),
      },
    ])
    ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      chatDeviceKeyEncrypted: "enc",
      status: "RUNNING",
    })
    ;(prismaMock.agent.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      agentSlug: "dev-commander",
    })
    ;(prismaMock.activityLog.update as ReturnType<typeof vi.fn>).mockResolvedValue({})
  })

  it("skips when the gateway is missing (leave held for the next flush)", async () => {
    mockGw.mockResolvedValue(null)
    const summary = await flushHeldChatSends("ws-1")
    expect(summary).toEqual({ flushed: 0, failed: 0 })
    expect(mockSend).not.toHaveBeenCalled()
    expect(prismaMock.activityLog.update).not.toHaveBeenCalled()
  })

  it("skips when the workspace is not RUNNING", async () => {
    ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      chatDeviceKeyEncrypted: "enc",
      status: "WAKING",
    })
    const summary = await flushHeldChatSends("ws-1")
    expect(summary).toEqual({ flushed: 0, failed: 0 })
    expect(mockSend).not.toHaveBeenCalled()
  })

  it("replays the held text with the stored runId as idempotencyKey", async () => {
    const summary = await flushHeldChatSends("ws-1")
    expect(summary).toEqual({ flushed: 1, failed: 0 })
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        message: heldFlushOwnerMessage("do the thing"),
        idempotencyKey: "run-hold",
        sessionKey: "agent:dev-commander:main",
      }),
    )
    expect(heldFlushOwnerMessage("do the thing")).toContain("workspace owner")
    expect(heldFlushOwnerMessage("do the thing")).toContain("do the thing")
    expect(heldFlushOwnerMessage("do the thing")).not.toMatch(/^do the thing$/)
    const meta = JSON.parse(
      (prismaMock.activityLog.update as ReturnType<typeof vi.fn>).mock.calls[0][0].data.metadata,
    )
    expect(meta.holdStatus).toBe("flushed")
  })

  it("leaves holdStatus held when the gateway send fails", async () => {
    mockSend.mockResolvedValue({ ok: false, reason: "unreachable" })
    const summary = await flushHeldChatSends("ws-1")
    expect(summary).toEqual({ flushed: 0, failed: 1 })
    expect(prismaMock.activityLog.update).not.toHaveBeenCalled()
  })
})

describe("MUTATION: hold flush is wired at wake and deploy-complete", () => {
  it("deploy complete and wakeWorkspace call flushHeldChatSends", () => {
    const deploy = readFileSync(
      join(process.cwd(), "src/app/api/deploy/[workspaceId]/complete/route.ts"),
      "utf8",
    )
    expect(deploy).toContain("flushHeldChatSends")
    const wake = readFileSync(join(process.cwd(), "src/lib/hibernation/manager.ts"), "utf8")
    expect(wake).toContain("flushHeldChatSends")
    const chat = readFileSync(join(process.cwd(), "src/app/api/workspaces/[id]/chat/route.ts"), "utf8")
    expect(chat).toContain("ledgerChatSendHeld")
    expect(chat).toContain("isHoldableChatStatus")
    expect(chat).not.toContain("Chat send rejected mid-boot")
    const page = readFileSync(join(process.cwd(), "src/app/dashboard/[workspaceId]/page.tsx"), "utf8")
    expect(page).toContain("CHAT_SEND_HELD_EVENT_KIND")
    const panel = readFileSync(join(process.cwd(), "src/components/dashboard/chat-panel.tsx"), "utf8")
    expect(panel).toContain("chat-send-events")
    expect(panel).not.toContain("chat-send-hold")
    expect(panel).not.toContain("@/lib/db")
    const history = readFileSync(
      join(process.cwd(), "src/app/api/workspaces/[id]/chat/history/route.ts"),
      "utf8",
    )
    expect(history).toContain("CHAT_SEND_HELD_EVENT_KIND")
  })
})
