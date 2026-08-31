import { describe, expect, it, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { prismaMock } from "@/test/helpers/mock-prisma"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))
vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const mockSendCriticalAlert = vi.fn()
vi.mock("@/lib/alerts/critical-alert-push", () => ({
  sendCriticalAlert: (...args: unknown[]) => mockSendCriticalAlert(...args),
}))

const mockSendOwnerAlert = vi.fn()
vi.mock("@/lib/alerts/owner-alert", () => ({
  sendOwnerAlert: (...args: unknown[]) => mockSendOwnerAlert(...args),
}))

const mockDeployToCloud = vi.fn()
vi.mock("@/lib/openclaw/deployer", () => ({
  deployToCloud: (...args: unknown[]) => mockDeployToCloud(...args),
}))

import {
  drainProvisioningQueueHead,
  enqueueFromQuotaRejection,
  enqueueProvisioning,
  recordSuccessfulCreate,
} from "@/lib/railway/governor"

const NOW = new Date("2026-08-19T12:00:00.000Z")

function eligibleUser() {
  return {
    trialUsed: true,
    trialStartedAt: new Date("2026-08-01T00:00:00.000Z"),
    trialEndsAt: new Date("2026-08-10T00:00:00.000Z"),
    hasActiveSubscription: true,
  }
}

function ineligibleUser() {
  return {
    trialUsed: true,
    trialStartedAt: new Date("2026-07-01T00:00:00.000Z"),
    trialEndsAt: new Date("2026-07-04T00:00:00.000Z"),
    hasActiveSubscription: false,
  }
}

beforeEach(() => {
  mockSendCriticalAlert.mockReset()
  mockSendCriticalAlert.mockResolvedValue({ sent: false, channel: "skipped" })
  mockSendOwnerAlert.mockReset()
  mockSendOwnerAlert.mockResolvedValue({ sent: false, channel: "skipped" })
  mockDeployToCloud.mockResolvedValue({ deploymentId: "d1", containerId: "s1", gatewayToken: "t" })
  ;(prismaMock.railwayCreateLedger.count as ReturnType<typeof vi.fn>).mockResolvedValue(23)
  ;(prismaMock.railwayCreateLedger.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
    Array.from({ length: 23 }, (_, i) => ({
      createdAt: new Date(NOW.getTime() - (20 - i) * 60 * 60 * 1000),
    })),
  )
  ;(prismaMock.railwayGovernorState.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null)
  ;(prismaMock.railwayGovernorState.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({
    id: "default",
    quotaHoldUntil: null,
  })
  ;(prismaMock.provisioningQueue.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(null)
  ;(prismaMock.provisioningQueue.upsert as ReturnType<typeof vi.fn>).mockResolvedValue({
    workspaceId: "ws-1",
    enqueuedAt: NOW,
    etaAt: new Date(NOW.getTime() + 4 * 60 * 60 * 1000),
  })
  ;(prismaMock.provisioningQueue.count as ReturnType<typeof vi.fn>).mockResolvedValue(1)
  ;(prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({})
})

describe("enqueueProvisioning", () => {
  it("over-cap → PROVISIONING_QUEUED with position + ETA; customer first-queue alert off", async () => {
    const queued = await enqueueProvisioning("ws-1", "budget", NOW)
    expect(queued.position).toBe(1)
    expect(queued.message).toContain("queued to provision")
    expect(prismaMock.workspace.update).toHaveBeenCalledWith({
      where: { id: "ws-1" },
      data: { status: "PROVISIONING_QUEUED" },
    })
    expect(prismaMock.workspace.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "ERROR" }) }),
    )
    expect(mockSendCriticalAlert).not.toHaveBeenCalled()
  })

  it("second enqueue for same workspace does not re-alert (first-entry only)", async () => {
    ;(prismaMock.provisioningQueue.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      enqueuedAt: NOW,
    })
    await enqueueProvisioning("ws-1", "budget", NOW)
    expect(mockSendCriticalAlert).not.toHaveBeenCalled()
  })
})

describe("reactive backstop", () => {
  it("Railway quota reject → hold + enqueue, never ERROR", async () => {
    ;(prismaMock.railwayCreateLedger.count as ReturnType<typeof vi.fn>).mockResolvedValue(0)
    ;(prismaMock.railwayCreateLedger.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([])
    const queued = await enqueueFromQuotaRejection("ws-1")
    expect(queued.reason).toBe("railway_quota")
    expect(prismaMock.railwayGovernorState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ quotaHoldUntil: expect.any(Date) }),
      }),
    )
    expect(prismaMock.workspace.update).toHaveBeenCalledWith({
      where: { id: "ws-1" },
      data: { status: "PROVISIONING_QUEUED" },
    })
  })
})

describe("drainProvisioningQueueHead", () => {
  it("ineligible head is dequeued and STOPPED - deployToCloud never runs", async () => {
    ;(prismaMock.railwayCreateLedger.count as ReturnType<typeof vi.fn>).mockResolvedValue(0)
    ;(prismaMock.railwayCreateLedger.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([])
    ;(prismaMock.provisioningQueue.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "q-1",
      workspaceId: "ws-stale",
      enqueuedAt: NOW,
      workspace: { id: "ws-stale", status: "PROVISIONING_QUEUED", user: ineligibleUser() },
    })
    ;(prismaMock.provisioningQueue.delete as ReturnType<typeof vi.fn>).mockResolvedValue({})

    const scheduled: Array<() => void | Promise<void>> = []
    const result = await drainProvisioningQueueHead((fn) => {
      scheduled.push(fn)
    })

    expect(result.skippedIneligible).toBe(1)
    expect(result.started).toBe(0)
    expect(scheduled).toHaveLength(0)
    expect(mockDeployToCloud).not.toHaveBeenCalled()
    expect(prismaMock.provisioningQueue.delete).toHaveBeenCalledWith({ where: { id: "q-1" } })
    expect(prismaMock.workspace.update).toHaveBeenCalledWith({
      where: { id: "ws-stale" },
      data: { status: "STOPPED" },
    })
  })

  it("eligible head + budget free → schedules deployToCloud via after()", async () => {
    ;(prismaMock.railwayCreateLedger.count as ReturnType<typeof vi.fn>).mockResolvedValue(0)
    ;(prismaMock.railwayCreateLedger.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([])
    ;(prismaMock.provisioningQueue.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "q-2",
      workspaceId: "ws-ok",
      enqueuedAt: NOW,
      workspace: { id: "ws-ok", status: "PROVISIONING_QUEUED", user: eligibleUser() },
    })
    ;(prismaMock.provisioningQueue.update as ReturnType<typeof vi.fn>).mockResolvedValue({})

    const scheduled: Array<() => void | Promise<void>> = []
    const result = await drainProvisioningQueueHead((fn) => {
      scheduled.push(fn)
    })
    expect(result.started).toBe(1)
    expect(scheduled).toHaveLength(1)
    await scheduled[0]!()
    expect(mockDeployToCloud).toHaveBeenCalledWith("ws-ok")
  })

  it("MUTATION: drain must re-check checkDeployEligibility (no stale resurrection)", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/railway/governor.ts"), "utf8")
    expect(src).toContain("checkDeployEligibility")
    expect(src).toContain("skippedIneligible")
    expect(src).toContain("STOPPED")
  })
})

describe("80% owner alert", () => {
  it("recordSuccessfulCreate at 20/25 pages founder only (sendOwnerAlert)", async () => {
    ;(prismaMock.railwayCreateLedger.count as ReturnType<typeof vi.fn>).mockResolvedValue(20)
    ;(prismaMock.railwayCreateLedger.findMany as ReturnType<typeof vi.fn>).mockResolvedValue(
      Array.from({ length: 20 }, () => ({ createdAt: NOW })),
    )
    ;(prismaMock.railwayCreateLedger.create as ReturnType<typeof vi.fn>).mockResolvedValue({})
    ;(prismaMock.provisioningQueue.deleteMany as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0 })

    await recordSuccessfulCreate("ws-1", "svc-1")
    expect(mockSendCriticalAlert).not.toHaveBeenCalled()
    expect(mockSendOwnerAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKey: "railway-create-budget",
        workspaceId: "ws-1",
      }),
    )
  })

  it("MUTATION: governor must not sendCriticalAlert for budget or queue", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/railway/governor.ts"), "utf8")
    expect(src).not.toContain("sendCriticalAlert")
    expect(src).toContain("sendOwnerAlert")
  })
})
