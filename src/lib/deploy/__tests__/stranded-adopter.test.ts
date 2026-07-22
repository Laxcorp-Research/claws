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
  resolvePreDeployWorkspaceStatus,
  STRANDED_DEPLOY_ERROR,
} from "@/lib/deploy/stranded-adopter"

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

  it("aged GENERATING deployment is adopted → FAILED + HIBERNATED wake restore", async () => {
    const startedAt = new Date(Date.now() - 20 * 60 * 1000)
    ;(prismaMock.deployment.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "dep-1",
        workspaceId: "ws-1",
        status: "GENERATING",
        startedAt,
        workspace: {
          id: "ws-1",
          status: "WAKING",
          containerId: null,
          containerState: { containerPhase: "WAKING" },
        },
      },
    ] as never)

    const result = await adoptStrandedDeployments()
    expect(result.adopted).toBe(1)
    expect(prismaMock.deployment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          errorMessage: STRANDED_DEPLOY_ERROR,
        }),
      }),
    )
    expect(prismaMock.workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { status: "HIBERNATED" },
      }),
    )
  })

  it("killed-mid-wake shape (WAKING + GENERATING past max age) is adopted for retry", async () => {
    // Mid-flight-504 / killed-mid-wake: workspace stuck WAKING, deploy left
    // GENERATING beyond STRANDED_DEPLOY_MAX_AGE_MIN — P4 watchdog adopts.
    const nowMs = Date.UTC(2026, 6, 22, 16, 15, 0)
    const startedAt = new Date(nowMs - 12 * 60 * 1000) // > default 10m
    ;(prismaMock.deployment.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "dep-midwake",
        workspaceId: "ws-midwake",
        status: "GENERATING",
        startedAt,
        workspace: {
          id: "ws-midwake",
          status: "WAKING",
          containerId: null,
          containerState: { containerPhase: "WAKING" },
        },
      },
    ] as never)

    const result = await adoptStrandedDeployments(nowMs)
    expect(result.adopted).toBe(1)
    expect(prismaMock.deployment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ["GENERATING", "PROVISIONING"] },
          startedAt: { lt: new Date(nowMs - 10 * 60 * 1000) },
        }),
      }),
    )
    expect(prismaMock.workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "ws-midwake" },
        data: { status: "HIBERNATED" },
      }),
    )
    expect(prismaMock.containerState.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { workspaceId: "ws-midwake" },
        data: expect.objectContaining({
          containerPhase: "HIBERNATED",
          wakeRequestedAt: null,
        }),
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
