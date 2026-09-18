// deployToFly: same observable contract as deployToCloud (Deployment walk,
// ContainerState upsert, env payloads, version-aware image) with Fly
// lifecycle underneath. Governor + service pool are NEVER consulted.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))

const mockCreateFlyApp = vi.fn()
const mockEnsureSharedIpV4 = vi.fn()
const mockCreateFlyMachine = vi.fn()
const mockUpdateFlyMachineConfig = vi.fn()
const mockStartFlyMachine = vi.fn()
const mockWaitForFlyMachineState = vi.fn()
const mockIsFlyConfigured = vi.fn()

vi.mock("@/lib/fly/machines-client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/fly/machines-client")>(
    "@/lib/fly/machines-client",
  )
  return {
    ...actual,
    isFlyConfigured: () => mockIsFlyConfigured(),
    createFlyApp: (...args: unknown[]) => mockCreateFlyApp(...args),
    ensureSharedIpV4: (...args: unknown[]) => mockEnsureSharedIpV4(...args),
    createFlyMachine: (...args: unknown[]) => mockCreateFlyMachine(...args),
    updateFlyMachineConfig: (...args: unknown[]) => mockUpdateFlyMachineConfig(...args),
    startFlyMachine: (...args: unknown[]) => mockStartFlyMachine(...args),
    waitForFlyMachineState: (...args: unknown[]) => mockWaitForFlyMachineState(...args),
  }
})

const mockGenerateWorkspace = vi.fn()
vi.mock("@/lib/openclaw/generator", async () => {
  const actual = await vi.importActual<typeof import("@/lib/openclaw/generator")>(
    "@/lib/openclaw/generator",
  )
  return {
    ...actual,
    generateWorkspace: (...args: unknown[]) => mockGenerateWorkspace(...args),
  }
})

vi.mock("@/lib/encryption", () => ({
  encrypt: (v: string) => `enc:${v}`,
  decrypt: (v: string) => v.replace(/^enc:/, ""),
}))

vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), deployEvent: vi.fn() },
}))

vi.mock("@/lib/deploy-events", () => ({
  publishDeployEvent: vi.fn().mockResolvedValue(undefined),
  clearDeployEvents: vi.fn().mockResolvedValue(undefined),
}))

vi.mock("@/lib/composio", () => ({
  getComposioUserId: (id: string) => `composio:${id}`,
}))

import { deployToFly } from "@/lib/fly/fly-deployer"

type MockFn = ReturnType<typeof vi.fn>

const mockFetch = vi.fn()

function generatedStub() {
  return {
    "openclaw.json": "{}",
    ".env": "",
    "cron/jobs.json": "[]",
    workspaces: {},
    gatewayToken: "gw-token",
  }
}

function workspaceStub() {
  return {
    id: "ws-1",
    userId: "user-1",
    status: "DRAFT",
    provider: "FLY",
    containerId: null,
    containerName: null,
    containerHost: null,
    channelConfigEncrypted: null,
    timezone: "UTC",
    gatewayToken: null,
    candidateRuntimeSoak: false,
    runtimeImagePin: null,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.FLY_IMAGE_MIRROR_PREFIX = "registry.fly.io/claws-runtime"
  process.env.NEXT_PUBLIC_APP_URL = "https://staging.app.buildclaws.ai"
  process.env.METERING_ENDPOINT = "https://staging.app.buildclaws.ai/api/internal/metering"
  process.env.ACTIVITY_ENDPOINT = "https://staging.app.buildclaws.ai/api/internal/activity"

  mockIsFlyConfigured.mockReturnValue(true)
  mockGenerateWorkspace.mockResolvedValue(generatedStub())
  mockCreateFlyApp.mockResolvedValue(undefined)
  mockEnsureSharedIpV4.mockResolvedValue(undefined)
  mockCreateFlyMachine.mockResolvedValue({ id: "mach-1", state: "started", region: "iad", name: "claw-ws-1" })
  mockUpdateFlyMachineConfig.mockResolvedValue({ id: "mach-1", state: "stopped", region: "iad", name: "claw-ws-1" })
  mockStartFlyMachine.mockResolvedValue(undefined)
  mockWaitForFlyMachineState.mockResolvedValue(undefined)

  // /healthz + /readyz probes over the fly.dev domain.
  mockFetch.mockResolvedValue({ ok: true, status: 200 } as unknown as Response)
  vi.stubGlobal("fetch", mockFetch)

  ;(prismaMock.workspace.findUniqueOrThrow as MockFn).mockResolvedValue(workspaceStub())
  ;(prismaMock.user.findUniqueOrThrow as MockFn).mockResolvedValue({
    id: "user-1",
    trialUsed: false,
    apiKeys: [],
  })
  ;(prismaMock.deployment.create as MockFn).mockResolvedValue({ id: "dep-fly-1" })
  ;(prismaMock.deployment.update as MockFn).mockResolvedValue({})
  ;(prismaMock.deployment.updateMany as MockFn).mockResolvedValue({ count: 0 })
  ;(prismaMock.deployment.findFirst as MockFn).mockResolvedValue({ version: 0 })
  ;(prismaMock.openClawVersion.findFirst as MockFn).mockResolvedValue({
    dockerImage: "ghcr.io/laxcorp-research/openclaw-runtime:2026.9.4-5",
    version: "2026.9.4-5",
    runtimeContract: "9.4",
    releasedAt: new Date(),
  })
  ;(prismaMock.containerState.upsert as MockFn).mockResolvedValue({ id: "cs-1" })
  ;(prismaMock.containerState.updateMany as MockFn).mockResolvedValue({ count: 1 })
  ;(prismaMock.workspace.update as MockFn).mockResolvedValue({})
  ;(prismaMock.$transaction as MockFn).mockImplementation(
    async (ops: unknown) => (Array.isArray(ops) ? Promise.all(ops) : ops),
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.FLY_IMAGE_MIRROR_PREFIX
})

describe("deployToFly", () => {
  it("fresh provision: app create -> shared IP -> machine create -> started wait -> COMPLETED; workspace bound to machine/app/domain", async () => {
    const result = await deployToFly("ws-1")

    expect(result.containerId).toBe("mach-1")
    expect(mockCreateFlyApp).toHaveBeenCalledWith("claw-ws-1")
    expect(mockEnsureSharedIpV4).toHaveBeenCalledWith("claw-ws-1")
    expect(mockWaitForFlyMachineState).toHaveBeenCalledWith("claw-ws-1", "mach-1", "started", expect.any(Number))
    expect(prismaMock.workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "RUNNING",
          containerId: "mach-1",
          containerName: "claw-ws-1",
          containerHost: "claw-ws-1.fly.dev",
        }),
      }),
    )
    // Deployment walk completed.
    expect(prismaMock.deployment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "dep-fly-1" },
        data: expect.objectContaining({ status: "COMPLETED" }),
      }),
    )
  })

  it("version-aware image unchanged: machine pulls the Fly mirror ref, Deployment row stores the canonical GHCR ref", async () => {
    await deployToFly("ws-1")

    const machineArgs = mockCreateFlyMachine.mock.calls[0][1] as { image: string; env: Record<string, string> }
    expect(machineArgs.image).toBe("registry.fly.io/claws-runtime:2026.9.4-5")
    expect(prismaMock.deployment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          containerImage: "ghcr.io/laxcorp-research/openclaw-runtime:2026.9.4-5",
          railwayProjectId: null,
        }),
      }),
    )
    // Same container payload contract as Railway (boots identically).
    expect(machineArgs.env).toEqual(
      expect.objectContaining({
        CLAWS_WORKSPACE_ID: "ws-1",
        CLAWS_CONFIG_GZ_B64: expect.any(String),
        CLAWS_BOOT_B64: expect.any(String),
        OPENCLAW_GATEWAY_TOKEN: "gw-token",
      }),
    )
  })

  it("governor + service pool are NEVER consulted on the Fly path (RAILWAY-only)", async () => {
    await deployToFly("ws-1")

    expect(prismaMock.railwayCreateLedger.count).not.toHaveBeenCalled()
    expect(prismaMock.railwayCreateLedger.create).not.toHaveBeenCalled()
    expect(prismaMock.servicePool.findFirst).not.toHaveBeenCalled()
    expect(prismaMock.provisioningQueue.upsert).not.toHaveBeenCalled()
  })

  it("wake on kept machine (HWD): config replace + start, no app/machine create", async () => {
    ;(prismaMock.workspace.findUniqueOrThrow as MockFn).mockResolvedValue({
      ...workspaceStub(),
      containerId: "mach-1",
      containerName: "claw-ws-1",
      containerHost: "claw-ws-1.fly.dev",
    })

    await deployToFly("ws-1", { forbidCreate: true })

    expect(mockUpdateFlyMachineConfig).toHaveBeenCalledWith(
      "claw-ws-1",
      "mach-1",
      expect.objectContaining({ image: "registry.fly.io/claws-runtime:2026.9.4-5" }),
    )
    expect(mockStartFlyMachine).toHaveBeenCalledWith("claw-ws-1", "mach-1")
    expect(mockCreateFlyMachine).not.toHaveBeenCalled()
    expect(mockCreateFlyApp).not.toHaveBeenCalled()
  })

  it("wake forbidCreate + machine gone -> throws (no silent re-create on the wake path)", async () => {
    ;(prismaMock.workspace.findUniqueOrThrow as MockFn).mockResolvedValue({
      ...workspaceStub(),
      containerId: "mach-gone",
      containerName: "claw-ws-1",
    })
    const notFound = Object.assign(new Error("Fly API GET returned 404: machine not found"), {})
    mockUpdateFlyMachineConfig.mockRejectedValue(notFound)

    await expect(deployToFly("ws-1", { forbidCreate: true })).rejects.toThrow(/forbidCreate/)
    expect(mockCreateFlyMachine).not.toHaveBeenCalled()
  })

  it("deploy failure converges ERROR/STOPPED unless preserveHibernationOnFailure", async () => {
    mockCreateFlyMachine.mockRejectedValue(new Error("Fly API POST returned 500"))

    await expect(deployToFly("ws-1")).rejects.toThrow(/500/)
    expect(prismaMock.workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "ERROR" } }),
    )

    vi.clearAllMocks()
    mockIsFlyConfigured.mockReturnValue(true)
    mockGenerateWorkspace.mockResolvedValue(generatedStub())
    mockCreateFlyApp.mockResolvedValue(undefined)
    mockEnsureSharedIpV4.mockResolvedValue(undefined)
    mockCreateFlyMachine.mockRejectedValue(new Error("Fly API POST returned 500"))
    ;(prismaMock.workspace.findUniqueOrThrow as MockFn).mockResolvedValue(workspaceStub())
    ;(prismaMock.user.findUniqueOrThrow as MockFn).mockResolvedValue({ id: "user-1", trialUsed: false, apiKeys: [] })
    ;(prismaMock.deployment.create as MockFn).mockResolvedValue({ id: "dep-fly-2" })
    ;(prismaMock.deployment.update as MockFn).mockResolvedValue({})
    ;(prismaMock.deployment.updateMany as MockFn).mockResolvedValue({ count: 0 })
    ;(prismaMock.deployment.findFirst as MockFn).mockResolvedValue({ version: 1 })
    ;(prismaMock.openClawVersion.findFirst as MockFn).mockResolvedValue({
      dockerImage: "ghcr.io/laxcorp-research/openclaw-runtime:2026.9.4-5",
      version: "2026.9.4-5",
      runtimeContract: "9.4",
      releasedAt: new Date(),
    })
    ;(prismaMock.containerState.upsert as MockFn).mockResolvedValue({ id: "cs-1" })

    await expect(deployToFly("ws-1", { preserveHibernationOnFailure: true })).rejects.toThrow(/500/)
    expect(prismaMock.workspace.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "ERROR" } }),
    )
  })

  it("refuses to run unconfigured (no silent simulation on Fly)", async () => {
    mockIsFlyConfigured.mockReturnValue(false)
    await expect(deployToFly("ws-1")).rejects.toThrow(/not configured/)
  })
})
