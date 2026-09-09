import { describe, expect, it, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { prismaMock } from "@/test/helpers/mock-prisma"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))
vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

const mockWake = vi.hoisted(() => vi.fn())
vi.mock("@/lib/hibernation/manager", () => ({
  wakeWorkspace: (...args: unknown[]) => mockWake(...args),
}))

const mockEnsureDomain = vi.hoisted(() => vi.fn())
vi.mock("@/lib/openclaw/railway-client", () => ({
  ensureServiceDomain: (...args: unknown[]) => mockEnsureDomain(...args),
}))

const mockOwnerAlert = vi.hoisted(() => vi.fn())
vi.mock("@/lib/alerts/owner-alert", () => ({
  sendOwnerAlert: (...args: unknown[]) => mockOwnerAlert(...args),
}))

const mockCritical = vi.hoisted(() => vi.fn())
vi.mock("@/lib/alerts/critical-alert-push", () => ({
  sendCriticalAlert: (...args: unknown[]) => mockCritical(...args),
}))

const mockLedger = vi.hoisted(() => vi.fn())
vi.mock("@/lib/healing/ledger", () => ({
  HEAL_ATTEMPT_EVENT_KIND: "heal_attempt",
  ledgerHealAttempt: (...args: unknown[]) => mockLedger(...args),
}))

import {
  executeSilentWakeHeal,
  shouldOwnerAlertSilentWake,
  DEFAULT_SILENT_WAKE_REALERT_MS,
} from "@/lib/healing/silent-wake"

const SUBSCRIBED = {
  trialUsed: true,
  trialStartedAt: new Date("2026-07-01T00:00:00.000Z"),
  trialEndsAt: new Date("2026-07-29T00:00:00.000Z"),
  hasActiveSubscription: true,
}

const EXPIRED = {
  ...SUBSCRIBED,
  hasActiveSubscription: false,
  trialEndsAt: new Date("2026-08-30T00:00:00.000Z"),
}

const NOW = new Date("2026-09-09T00:20:00.000Z")

function stuckRow(status: "HIBERNATED" | "ERROR", user = SUBSCRIBED) {
  return {
    id: "ws-stuck",
    status,
    containerId: "svc-1",
    containerHost: "claw.up.railway.app",
    user,
    containerState: {
      nextHeartbeatAt: new Date("2026-08-18T12:00:00.000Z"),
      heartbeatInterval: 4 * 60 * 60 * 1000,
      heartbeatCronExpressions: "[]",
    },
  }
}

describe("shouldOwnerAlertSilentWake", () => {
  it("silent-past-window → owner alert on first miss and after one window", () => {
    expect(
      shouldOwnerAlertSilentWake({
        lastOwnerAlertAt: null,
        now: NOW,
        realertMs: DEFAULT_SILENT_WAKE_REALERT_MS,
      }),
    ).toBe(true)
    expect(
      shouldOwnerAlertSilentWake({
        lastOwnerAlertAt: new Date(NOW.getTime() - 60 * 60 * 1000),
        now: NOW,
        realertMs: DEFAULT_SILENT_WAKE_REALERT_MS,
      }),
    ).toBe(false)
    expect(
      shouldOwnerAlertSilentWake({
        lastOwnerAlertAt: new Date(NOW.getTime() - DEFAULT_SILENT_WAKE_REALERT_MS),
        now: NOW,
        realertMs: DEFAULT_SILENT_WAKE_REALERT_MS,
      }),
    ).toBe(true)
  })
})

describe("executeSilentWakeHeal", () => {
  beforeEach(() => {
    mockWake.mockReset()
    mockWake.mockResolvedValue(undefined)
    mockEnsureDomain.mockReset()
    mockEnsureDomain.mockResolvedValue("claw.up.railway.app")
    mockOwnerAlert.mockReset()
    mockOwnerAlert.mockResolvedValue({ sent: true, channel: "email" })
    mockCritical.mockReset()
    mockCritical.mockResolvedValue({ sent: false, channel: "skipped" })
    mockLedger.mockReset()
    mockLedger.mockResolvedValue(undefined)
    ;(prismaMock.activityLog.findFirst as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    ;(prismaMock.activityLog.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([])
  })

  it("stuck-hibernated fixture → heals", async () => {
    ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      stuckRow("HIBERNATED"),
    )
    const result = await executeSilentWakeHeal({
      workspaceId: "ws-stuck",
      trigger: "stuck-hibernated",
      now: NOW,
    })
    expect(result).toBe("healed")
    expect(mockEnsureDomain).toHaveBeenCalledWith("svc-1", "claw.up.railway.app")
    expect(mockWake).toHaveBeenCalledWith("ws-stuck")
    expect(mockOwnerAlert).toHaveBeenCalledWith(
      expect.objectContaining({ alertKey: "silent-wake", workspaceId: "ws-stuck" }),
    )
    expect(mockCritical).not.toHaveBeenCalled()
  })

  it("ERROR silent-past-window → owner alert + wake", async () => {
    ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      stuckRow("ERROR"),
    )
    const result = await executeSilentWakeHeal({
      workspaceId: "ws-stuck",
      trigger: "missed-wake",
      now: NOW,
    })
    expect(result).toBe("healed")
    expect(mockOwnerAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        alertKey: "silent-wake",
        title: expect.stringContaining("Silent claw"),
      }),
    )
    expect(mockWake).toHaveBeenCalledWith("ws-stuck")
  })

  it("expired trial → customer nudge, no wake", async () => {
    ;(prismaMock.workspace.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue(
      stuckRow("HIBERNATED", EXPIRED),
    )
    const result = await executeSilentWakeHeal({
      workspaceId: "ws-stuck",
      trigger: "entitlement-denied",
      now: NOW,
    })
    expect(result).toBe("nudged")
    expect(mockWake).not.toHaveBeenCalled()
    expect(mockOwnerAlert).toHaveBeenCalled()
    expect(mockCritical).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-stuck",
        alertKey: "heartbeat-missed",
      }),
    )
  })

  it("MUTATION: health-monitor must schedule silent-wake on missed-wake", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/api/cron/health-monitor/route.ts"),
      "utf8",
    )
    expect(src).toContain("scheduleSilentWakeHeal")
    expect(src).toContain('trigger: "missed-wake"')
    expect(src).toContain("missedWakeWorkspaceWhere")
    expect(src).toContain("needsSubscription")
  })

  it("MUTATION: hibernation cron must keep ERROR in wakeHibernatedWhere via predicates", () => {
    const pred = readFileSync(
      join(process.cwd(), "src/lib/hibernation/predicates.ts"),
      "utf8",
    )
    const wakeFn = pred.match(
      /export function wakeHibernatedWhere\(\)[\s\S]*?(?=export |$)/,
    )?.[0]
    expect(wakeFn).toContain('status: "ERROR"')
    expect(wakeFn).not.toContain("nextHeartbeatNotImminent")
  })
})
