import { beforeEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import { readFileSync } from "node:fs"
import { join } from "node:path"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))
vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import {
  adoptStrandedDeployments,
  isWakeOriginStrand,
  NON_TERMINAL_DEPLOYMENT_STATUSES,
  resolvePreDeployWorkspaceStatus,
  strandedDeployErrorMessage,
  TERMINAL_DEPLOYMENT_STATUSES,
} from "@/lib/deploy/stranded-adopter"

const CRON_12_16_20 = JSON.stringify([
  { schedule: { kind: "cron", expr: "0 12,16,20 * * *", tz: "UTC" } },
])

describe("DeploymentStatus census (P4.1)", () => {
  it("enumerates every non-terminal + terminal status; HEALTH_CHECK is adoptable", () => {
    expect(NON_TERMINAL_DEPLOYMENT_STATUSES).toEqual([
      "PENDING",
      "GENERATING",
      "PROVISIONING",
      "CONFIGURING",
      "STARTING",
      "HEALTH_CHECK",
      "WAITING_CHANNELS",
    ])
    expect(TERMINAL_DEPLOYMENT_STATUSES).toEqual([
      "COMPLETED",
      "FAILED",
      "ROLLED_BACK",
    ])
    // Schema has no STARTING_GATEWAY — gateway boot uses STARTING.
    expect(NON_TERMINAL_DEPLOYMENT_STATUSES).not.toContain("STARTING_GATEWAY")
    expect(NON_TERMINAL_DEPLOYMENT_STATUSES).toContain("HEALTH_CHECK")
  })

  it("MUTATION: drop HEALTH_CHECK from NON_TERMINAL list → fail", () => {
    const src = readFileSync(
      join(process.cwd(), "src/lib/deploy/stranded-adopter.ts"),
      "utf8",
    )
    expect(src).toMatch(/NON_TERMINAL_DEPLOYMENT_STATUSES\s*=\s*\[[\s\S]*?"HEALTH_CHECK"/)
    expect(NON_TERMINAL_DEPLOYMENT_STATUSES).toContain("HEALTH_CHECK")
  })

  it("honest per-phase error names the stuck status", () => {
    expect(strandedDeployErrorMessage("HEALTH_CHECK")).toBe(
      "Deployment stranded: stuck in HEALTH_CHECK beyond max age — marked FAILED for retry",
    )
    expect(strandedDeployErrorMessage("CONFIGURING")).toContain("CONFIGURING")
  })
})

describe("resolvePreDeployWorkspaceStatus", () => {
  it("wake path → HIBERNATED (retriable)", () => {
    expect(
      resolvePreDeployWorkspaceStatus({
        workspaceStatus: "WAKING",
        containerPhase: "WAKING",
        hadContainerId: true,
      }),
    ).toEqual({ status: "HIBERNATED", containerPhase: "HIBERNATED" })
  })

  it("already-HIBERNATED orphan deploy stays HIBERNATED (not demoted to DRAFT)", () => {
    expect(
      resolvePreDeployWorkspaceStatus({
        workspaceStatus: "HIBERNATED",
        containerPhase: "HIBERNATED",
        hadContainerId: false,
      }),
    ).toEqual({ status: "HIBERNATED", containerPhase: "HIBERNATED" })
  })

  it("DEPLOYING with prior container → STOPPED", () => {
    expect(
      resolvePreDeployWorkspaceStatus({
        workspaceStatus: "DEPLOYING",
        containerPhase: "RUNNING",
        hadContainerId: true,
      }),
    ).toEqual({ status: "STOPPED", containerPhase: "STOPPED" })
  })

  it("first deploy → DRAFT", () => {
    expect(
      resolvePreDeployWorkspaceStatus({
        workspaceStatus: "DEPLOYING",
        containerPhase: null,
        hadContainerId: false,
      }),
    ).toEqual({ status: "DRAFT", containerPhase: "STOPPED" })
  })
})

describe("isWakeOriginStrand", () => {
  it("WAKING and HIBERNATED are wake-origin", () => {
    expect(isWakeOriginStrand({ workspaceStatus: "WAKING", containerPhase: "WAKING" })).toBe(
      true,
    )
    expect(
      isWakeOriginStrand({ workspaceStatus: "HIBERNATED", containerPhase: "HIBERNATED" }),
    ).toBe(true)
  })

  it("fresh DEPLOYING is not wake-origin", () => {
    expect(
      isWakeOriginStrand({ workspaceStatus: "DEPLOYING", containerPhase: "RUNNING" }),
    ).toBe(false)
  })
})

describe("adoptStrandedDeployments", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(prismaMock.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (ops: unknown) => {
        if (Array.isArray(ops)) return Promise.all(ops as Promise<unknown>[])
        return undefined
      },
    )
    ;(prismaMock.deployment.update as ReturnType<typeof vi.fn>).mockResolvedValue({} as never)
    ;(prismaMock.workspace.update as ReturnType<typeof vi.fn>).mockResolvedValue({} as never)
    ;(prismaMock.containerState.updateMany as ReturnType<typeof vi.fn>).mockResolvedValue({
      count: 1,
    } as never)
  })

  function mockStranded(args: {
    id: string
    status: string
    startedAt: Date
    workspaceStatus: string
    containerPhase: string | null
    containerId?: string | null
    cron?: string | null
    intervalMs?: number | null
  }) {
    ;(prismaMock.deployment.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: args.id,
        workspaceId: "ws-1",
        status: args.status,
        startedAt: args.startedAt,
        workspace: {
          id: "ws-1",
          status: args.workspaceStatus,
          containerId: args.containerId ?? null,
          containerState: {
            containerPhase: args.containerPhase,
            heartbeatCronExpressions: args.cron ?? null,
            heartbeatInterval: args.intervalMs ?? null,
          },
        },
      },
    ] as never)
  }

  it.each([...NON_TERMINAL_DEPLOYMENT_STATUSES])(
    "aged %s deployment is adopted → FAILED + honest per-phase error",
    async (phase) => {
      const nowMs = Date.UTC(2026, 6, 22, 17, 0, 0)
      const startedAt = new Date(nowMs - 12 * 60 * 1000)
      mockStranded({
        id: `dep-${phase}`,
        status: phase,
        startedAt,
        workspaceStatus: "WAKING",
        containerPhase: "WAKING",
        cron: CRON_12_16_20,
      })

      const result = await adoptStrandedDeployments(nowMs)
      expect(result.adopted).toBe(1)
      expect(prismaMock.deployment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: "FAILED",
            errorMessage: strandedDeployErrorMessage(phase),
          }),
        }),
      )
    },
  )

  it("findMany queries the full NON_TERMINAL set (includes HEALTH_CHECK)", async () => {
    const nowMs = Date.UTC(2026, 6, 22, 17, 0, 0)
    ;(prismaMock.deployment.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([])
    await adoptStrandedDeployments(nowMs)
    expect(prismaMock.deployment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: [...NON_TERMINAL_DEPLOYMENT_STATUSES] },
          startedAt: { lt: new Date(nowMs - 10 * 60 * 1000) },
          completedAt: null,
        }),
      }),
    )
    const calledIn = (
      prismaMock.deployment.findMany as ReturnType<typeof vi.fn>
    ).mock.calls[0][0].where.status.in as string[]
    expect(calledIn).toContain("HEALTH_CHECK")
    expect(calledIn).toContain("WAITING_CHANNELS")
    expect(calledIn).toContain("STARTING")
  })

  it("healthy in-flight deploy under threshold is untouched (findMany cutoff)", async () => {
    const nowMs = Date.UTC(2026, 6, 22, 17, 0, 0)
    ;(prismaMock.deployment.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([])
    const result = await adoptStrandedDeployments(nowMs)
    expect(result.adopted).toBe(0)
    expect(prismaMock.deployment.update).not.toHaveBeenCalled()
    // Cutoff is now − 10m: a deploy started 5m ago would not match lt:cutoff.
    expect(prismaMock.deployment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          startedAt: { lt: new Date(nowMs - 10 * 60 * 1000) },
        }),
      }),
    )
  })

  it("wake-origin strand re-arms nextHeartbeatAt from cron (schedule survives)", async () => {
    // Mid-wake kill at 16:00; adopt at 17:00 → next cron fire 20:00Z.
    const nowMs = Date.UTC(2026, 6, 22, 17, 0, 0)
    const startedAt = new Date(nowMs - 12 * 60 * 1000)
    mockStranded({
      id: "dep-midwake-hc",
      status: "HEALTH_CHECK",
      startedAt,
      workspaceStatus: "WAKING",
      containerPhase: "WAKING",
      cron: CRON_12_16_20,
    })

    const result = await adoptStrandedDeployments(nowMs)
    expect(result.adopted).toBe(1)
    expect(prismaMock.workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: "HIBERNATED" },
      }),
    )
    expect(prismaMock.containerState.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: "ws-1" },
        data: expect.objectContaining({
          containerPhase: "HIBERNATED",
          wakeRequestedAt: null,
          nextHeartbeatAt: new Date("2026-07-22T20:00:00.000Z"),
        }),
      }),
    )
  })

  it("non-wake DEPLOYING strand does not re-arm nextHeartbeatAt", async () => {
    const nowMs = Date.UTC(2026, 6, 22, 17, 0, 0)
    mockStranded({
      id: "dep-fresh",
      status: "PROVISIONING",
      startedAt: new Date(nowMs - 15 * 60 * 1000),
      workspaceStatus: "DEPLOYING",
      containerPhase: "RUNNING",
      containerId: "svc-1",
      cron: CRON_12_16_20,
    })

    await adoptStrandedDeployments(nowMs)
    expect(prismaMock.containerState.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          containerPhase: "STOPPED",
          wakeRequestedAt: null,
        },
      }),
    )
  })

  it("killed-mid-wake HEALTH_CHECK (fixture shape) adopted for retry", async () => {
    const nowMs = Date.UTC(2026, 6, 22, 16, 20, 0)
    const startedAt = new Date("2026-07-22T16:00:50.828Z")
    mockStranded({
      id: "cmrw9ribw000004joa6vcda3g",
      status: "HEALTH_CHECK",
      startedAt,
      workspaceStatus: "HIBERNATED",
      containerPhase: "HIBERNATED",
      cron: CRON_12_16_20,
    })

    const result = await adoptStrandedDeployments(nowMs)
    expect(result.adopted).toBe(1)
    expect(prismaMock.deployment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          errorMessage: strandedDeployErrorMessage("HEALTH_CHECK"),
        }),
      }),
    )
    expect(prismaMock.workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: "HIBERNATED" },
      }),
    )
  })

  it("MUTATION: health-monitor must call adoptStrandedDeployments (skip → fail)", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/api/cron/health-monitor/route.ts"),
      "utf8",
    )
    expect(src).toContain("adoptStrandedDeployments")
  })
})

describe("isOrphanRailwayServiceError — P4 NotAuthorized fall-through (source lock)", () => {
  const deployerSrc = readFileSync(join(process.cwd(), "src/lib/openclaw/deployer.ts"), "utf8")

  it("MUTATION: redeploy catch uses isOrphanRailwayServiceError (restore rethrow-missing-only → fail)", () => {
    expect(deployerSrc).toContain("isOrphanRailwayServiceError(redeployErr)")
    const catchBlock = deployerSrc.slice(
      deployerSrc.indexOf("Failed to update existing service"),
      deployerSrc.indexOf("Service already exists, looking it up by name"),
    )
    expect(catchBlock).toContain("isOrphanRailwayServiceError")
    expect(catchBlock).not.toMatch(
      /if\s*\(\s*!isMissingRailwayServiceError\(redeployErr\)\s*\)\s*\{\s*throw/,
    )
  })

  it("fresh-provision auth outage fails loud (no infinite-provision loop)", () => {
    expect(deployerSrc).toContain("Railway auth outage on fresh provision after orphan clear")
    expect(deployerSrc).toContain("isRailwayAuthOutageError")
    expect(deployerSrc).toContain("NotAuthorized")
  })
})
