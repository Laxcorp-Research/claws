import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import {
  DOCKER_GATEWAY_PORT,
  DOCKER_STATE_MOUNT,
  type DockerControl,
  type DockerCreateSpec,
} from "@/lib/openclaw/docker-engine"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))
vi.mock("@/lib/encryption", () => ({
  encrypt: (v: string) => `enc:${v}`,
  decrypt: (v: string) => v.replace(/^enc:/, ""),
}))
vi.mock("@/lib/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))
vi.mock("@/lib/deploy/supersede-deployments", () => ({
  supersedePriorDeployments: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/openclaw/generator", () => ({
  generateWorkspace: vi.fn().mockResolvedValue({
    gatewayToken: "generated-token",
    runtimeContract: "9.4",
    "openclaw.json": "{}",
    ".env": "ANTHROPIC_API_KEY=sk-ant-founder-local\n",
    workspaces: {},
    "cron/jobs.json": "{}",
  }),
}))

import { generateWorkspace } from "@/lib/openclaw/generator"
import {
  __setDockerControlForTests,
  __setGatewayHealthProbeForTests,
  __setGatewayUpgradeProbeForTests,
  deployToDocker,
  destroyDockerWorkspace,
  stopDockerContainer,
} from "@/lib/openclaw/docker-provider"

type MockFn = ReturnType<typeof vi.fn>

function fakeEngine() {
  const calls: { op: string; arg: unknown }[] = []
  let created = 0
  const engine: DockerControl = {
    ensureVolume: vi.fn(async (name: string) => {
      calls.push({ op: "ensureVolume", arg: name })
    }),
    createContainer: vi.fn(async (spec: DockerCreateSpec) => {
      calls.push({ op: "createContainer", arg: spec })
      created += 1
      return `ctr-${created}`
    }),
    start: vi.fn(async (id: string) => {
      calls.push({ op: "start", arg: id })
    }),
    stop: vi.fn(async (id: string) => {
      calls.push({ op: "stop", arg: id })
    }),
    remove: vi.fn(async (id: string) => {
      calls.push({ op: "remove", arg: id })
    }),
    inspect: vi.fn(async (id: string) => {
      calls.push({ op: "inspect", arg: id })
      return { running: true, exitCode: null, publishedPort: 32768 }
    }),
    logs: vi.fn(async (id: string) => {
      calls.push({ op: "logs", arg: id })
      return ""
    }),
    removeVolume: vi.fn(async (name: string) => {
      calls.push({ op: "removeVolume", arg: name })
    }),
  }
  return { engine, calls }
}

function workspace(overrides: Record<string, unknown> = {}) {
  return {
    id: "ws-1",
    gatewayToken: null,
    containerId: null,
    containerName: null,
    containerHost: null,
    ...overrides,
  }
}

beforeEach(() => {
  process.env.CLAWS_DOCKER_IMAGE = "claws-fixture-gateway:proof"
  process.env.RUNTIME_IMAGE_TAG = "2026.9.4-5"
  delete process.env.CLAWS_DOCKER_PUBLISH
  delete process.env.CLAWS_DOCKER_PROXY_HOST
  delete process.env.CLAWS_DOCKER_DIAL
  process.env.CLAWS_DOCKER_NETWORK = "claws"
  __setGatewayHealthProbeForTests(async () => true)
  __setGatewayUpgradeProbeForTests(async () => ({ ok: true, status: 101, body: "" }))
  ;(prismaMock.openClawVersion.findUnique as MockFn).mockResolvedValue({ runtimeContract: "9.4" })
  ;(prismaMock.workspace.findUniqueOrThrow as MockFn).mockResolvedValue(workspace())
  ;(prismaMock.workspace.update as MockFn).mockResolvedValue({})
  ;(prismaMock.containerState.upsert as MockFn).mockResolvedValue({})
  ;(prismaMock.deployment.findFirst as MockFn).mockResolvedValue(null)
  ;(prismaMock.deployment.create as MockFn).mockResolvedValue({ id: "dep-1" })
  ;(prismaMock.deployment.update as MockFn).mockResolvedValue({})
})

afterEach(() => {
  __setDockerControlForTests(null)
  __setGatewayHealthProbeForTests(null)
  __setGatewayUpgradeProbeForTests(null)
  delete process.env.CLAWS_DOCKER_IMAGE
  delete process.env.RUNTIME_IMAGE_TAG
  delete process.env.CLAWS_DOCKER_PUBLISH
  delete process.env.CLAWS_DOCKER_PROXY_HOST
  delete process.env.CLAWS_DOCKER_DIAL
  delete process.env.CLAWS_PROFILE
  delete process.env.CONTROL_PLANE_INTERNAL_URL
})

describe("docker provider", () => {
  it("creates a named volume, publishes the gateway port, and records the container", async () => {
    const { engine, calls } = fakeEngine()
    __setDockerControlForTests(engine)

    const result = await deployToDocker("ws-1")

    expect(result.containerId).toBe("ctr-1")
    expect(result.gatewayToken).toBe("generated-token")
    expect(calls.map((c) => c.op)).toEqual([
      "ensureVolume",
      "createContainer",
      "start",
      "inspect",
    ])
    expect(calls[0]?.arg).toBe("claws-ws-1")
    const spec = calls[1]?.arg as DockerCreateSpec
    expect(spec.volumeName).toBe("claws-ws-1")
    expect(spec.publish).toBe("host")
    expect(spec.network).toBe("claws")
    expect(spec.image).toBe("claws-fixture-gateway:proof")
    expect(spec.command).toBeUndefined()
    expect(spec.env.some((line) => line.startsWith("CLAWS_BOOT_B64="))).toBe(false)
    expect(spec.env).not.toContain("ANTHROPIC_API_KEY=sk-ant-founder-local")
    expect(spec.env).toContain("GATEWAY_TOKEN=generated-token")
    expect(prismaMock.workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          provider: "DOCKER",
          containerId: "ctr-1",
          containerHost: `claws-ws-1:${DOCKER_GATEWAY_PORT}`,
          hostPort: 32768,
          status: "RUNNING",
        }),
      }),
    )
    expect(prismaMock.containerState.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ savedVolumeId: "claws-ws-1" }),
      }),
    )
    expect(DOCKER_STATE_MOUNT).toBe("/home/node/.openclaw")
  })

  it("a real runtime image boots with the unpack command and the pasted Anthropic key", async () => {
    process.env.CLAWS_DOCKER_IMAGE = "ghcr.io/laxcorp-research/openclaw-runtime:2026.9.4-5"
    ;(generateWorkspace as MockFn).mockResolvedValueOnce({
      gatewayToken: "generated-token",
      runtimeContract: "9.4",
      "openclaw.json": "{\"agents\":[]}",
      ".env": "ANTHROPIC_API_KEY=sk-ant-founder-local\nOPENCLAW_GATEWAY_TOKEN=generated-token\n",
      workspaces: { "workspace-a": { "SOUL.md": "soul" } },
      "cron/jobs.json": "{}",
      seedFiles: { "shared/VOICE.md": "voice" },
    })
    const { engine, calls } = fakeEngine()
    __setDockerControlForTests(engine)

    await deployToDocker("ws-1")

    const spec = calls.find((c) => c.op === "createContainer")?.arg as DockerCreateSpec
    expect(spec.command).toEqual([
      "/bin/sh",
      "-c",
      "echo $CLAWS_BOOT_B64 | base64 -d > /tmp/boot.sh && exec sh /tmp/boot.sh",
    ])
    expect(spec.env.some((line) => line.startsWith("CLAWS_BOOT_B64="))).toBe(true)
    expect(spec.env.some((line) => line.startsWith("CLAWS_CONFIG_GZ_B64="))).toBe(true)
    expect(spec.env.some((line) => line.startsWith("CLAWS_ENV_GZ_B64="))).toBe(true)
    expect(spec.env.some((line) => line.startsWith("CLAWS_FILES_GZ_B64="))).toBe(true)
    expect(spec.env.some((line) => line.startsWith("CLAWS_SEED_FILES_GZ_B64="))).toBe(true)
    expect(spec.env).toContain("ANTHROPIC_API_KEY=sk-ant-founder-local")
    expect(spec.env).toContain("OPENCLAW_GATEWAY_TOKEN=generated-token")
    expect(spec.env).toContain("OPENCLAW_CONFIG_READONLY=1")
  })

  it("self-host injects CLAWS_METERING_SECRET and the in-network metering URL", async () => {
    process.env.CLAWS_PROFILE = "self-host"
    process.env.CONTROL_PLANE_INTERNAL_URL = "http://app:3000"
    process.env.CLAWS_DOCKER_IMAGE = "ghcr.io/laxcorp-research/openclaw-runtime:2026.9.4-5"
    ;(prismaMock.workspace.findUnique as MockFn).mockResolvedValue({
      syncSecretEncrypted: "enc:workspace-sync-secret",
    })
    const { engine, calls } = fakeEngine()
    __setDockerControlForTests(engine)

    await deployToDocker("ws-1")

    const spec = calls.find((c) => c.op === "createContainer")?.arg as DockerCreateSpec
    expect(spec.env).toContain("CLAWS_METERING_SECRET=workspace-sync-secret")
    expect(spec.env).toContain("CLAWS_METERING_ENDPOINT=http://app:3000/api/internal/metering")
    expect(spec.env.some((line) => line.startsWith("METERING_MASTER_SECRET="))).toBe(false)
  })

  it("self-host recreates a container that is missing CLAWS_METERING_SECRET and keeps the volume", async () => {
    process.env.CLAWS_PROFILE = "self-host"
    process.env.CONTROL_PLANE_INTERNAL_URL = "http://app:3000"
    process.env.CLAWS_DOCKER_IMAGE = "claws-fixture-gateway:proof"
    let containerId: string | null = "old-ctr"
    ;(prismaMock.workspace.findUnique as MockFn).mockImplementation(async (args: { select?: { syncSecretEncrypted?: boolean } }) => {
      if (args?.select?.syncSecretEncrypted) return { syncSecretEncrypted: "enc:workspace-sync-secret" }
      return { containerId, provider: "DOCKER" }
    })
    ;(prismaMock.workspace.findUniqueOrThrow as MockFn).mockImplementation(async () => workspace({ containerId }))
    ;(prismaMock.workspace.update as MockFn).mockImplementation(async (args: { data?: { containerId?: string | null } }) => {
      if (args?.data && "containerId" in args.data) containerId = args.data.containerId ?? null
      return {}
    })
    const { engine, calls } = fakeEngine()
    engine.env = vi.fn(async () => ["GATEWAY_TOKEN=old"])
    __setDockerControlForTests(engine)

    const { ensureDockerSyncEnv } = await import("@/lib/openclaw/docker-provider")
    await ensureDockerSyncEnv("ws-1")

    expect(calls.map((c) => c.op)).toContain("remove")
    expect(calls.map((c) => c.op)).toContain("ensureVolume")
    const spec = calls.find((c) => c.op === "createContainer")?.arg as DockerCreateSpec
    expect(spec.volumeName).toBe("claws-ws-1")
    expect(spec.env).toContain("CLAWS_METERING_SECRET=workspace-sync-secret")
  })

  it("proxy mode does not publish a host port and dials CLAWS_DOCKER_PROXY_HOST", async () => {
    process.env.CLAWS_DOCKER_PUBLISH = "proxy"
    process.env.CLAWS_DOCKER_PROXY_HOST = "gateway.internal:443"
    const { engine, calls } = fakeEngine()
    __setDockerControlForTests(engine)

    await deployToDocker("ws-1")

    const spec = calls.find((c) => c.op === "createContainer")?.arg as DockerCreateSpec
    expect(spec.publish).toBe("proxy")
    expect(prismaMock.workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ containerHost: "gateway.internal:443" }),
      }),
    )
  })

  it("proxy mode without CLAWS_DOCKER_PROXY_HOST throws and does not start", async () => {
    process.env.CLAWS_DOCKER_PUBLISH = "proxy"
    const { engine, calls } = fakeEngine()
    __setDockerControlForTests(engine)

    await expect(deployToDocker("ws-1")).rejects.toThrow(/CLAWS_DOCKER_PROXY_HOST/)
    expect(calls).toEqual([])
  })

  it("hibernate stop does not remove the container or the named volume", async () => {
    const { engine, calls } = fakeEngine()
    __setDockerControlForTests(engine)

    await stopDockerContainer("ctr-1")

    expect(calls.map((c) => c.op)).toEqual(["stop"])
    expect(engine.remove).not.toHaveBeenCalled()
    expect(engine.removeVolume).not.toHaveBeenCalled()
  })

  it("wake starts the existing container and does not create another", async () => {
    ;(prismaMock.workspace.findUniqueOrThrow as MockFn).mockResolvedValue(
      workspace({
        containerId: "ctr-existing",
        containerName: "claws-ws-1",
        containerHost: "claws-ws-1:18789",
        gatewayToken: "enc:kept-token",
      }),
    )
    const { engine, calls } = fakeEngine()
    __setDockerControlForTests(engine)

    const result = await deployToDocker("ws-1", { forbidCreate: true })

    expect(result.containerId).toBe("ctr-existing")
    expect(result.gatewayToken).toBe("kept-token")
    expect(calls.map((c) => c.op)).toEqual(["start", "inspect"])
    expect(engine.createContainer).not.toHaveBeenCalled()
    expect(engine.ensureVolume).not.toHaveBeenCalled()
  })

  it("forbidCreate with no container throws instead of creating", async () => {
    const { engine } = fakeEngine()
    __setDockerControlForTests(engine)

    await expect(deployToDocker("ws-1", { forbidCreate: true })).rejects.toThrow(/no container/)
    expect(engine.createContainer).not.toHaveBeenCalled()
  })

  it("a container that exits with code 1 marks the deployment FAILED with the log excerpt and never COMPLETED", async () => {
    const { engine } = fakeEngine()
    const deadLog = [
      "Starting via process-manager",
      "Gateway failed to start: Invalid config at /home/node/.openclaw/openclaw.json.",
      "agents.defaults: Invalid input",
      "agents: Invalid input",
    ].join("\n")
    ;(engine.inspect as MockFn).mockImplementation(async () => ({
      running: false,
      exitCode: 1,
      publishedPort: null,
    }))
    ;(engine.logs as MockFn).mockResolvedValue(deadLog)
    __setDockerControlForTests(engine)

    await expect(deployToDocker("ws-1")).rejects.toThrow(/Gateway failed to start/)

    const updates = (prismaMock.deployment.update as MockFn).mock.calls.map((call) => call[0])
    expect(updates.some((update) => update.data.status === "COMPLETED")).toBe(false)
    expect(updates).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          errorMessage: expect.stringContaining("Gateway failed to start: Invalid config"),
        }),
      }),
    ])
    expect(prismaMock.workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "ERROR" }),
      }),
    )
  })

  it("a gateway that answers /healthz but rejects the websocket upgrade is FAILED, never COMPLETED", async () => {
    const { engine } = fakeEngine()
    __setDockerControlForTests(engine)
    __setGatewayUpgradeProbeForTests(async () => ({
      ok: false,
      status: 403,
      body: '{"error":{"message":"Proxy client attribution is required. Configure gateway.trustedProxies narrowly and make the proxy overwrite or safely rebuild forwarded client headers.","type":"proxy_attribution_required"}}',
    }))

    await expect(deployToDocker("ws-1")).rejects.toThrow(/Proxy client attribution is required/)

    const updates = (prismaMock.deployment.update as MockFn).mock.calls.map((call) => call[0])
    expect(updates.some((update) => update.data.status === "COMPLETED")).toBe(false)
    expect(updates).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          errorMessage: expect.stringContaining("Proxy client attribution is required"),
        }),
      }),
    ])
    expect(prismaMock.workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "ERROR", healthStatus: "UNHEALTHY" }),
      }),
    )
  })

  it("passes a null runtime contract through and does not start a container", async () => {
    ;(prismaMock.openClawVersion.findUnique as MockFn).mockResolvedValue(null)
    ;(generateWorkspace as MockFn).mockRejectedValueOnce(new Error("RUNTIME_CONTRACT_UNKNOWN"))
    const { engine } = fakeEngine()
    __setDockerControlForTests(engine)

    await expect(deployToDocker("ws-1")).rejects.toThrow("RUNTIME_CONTRACT_UNKNOWN")
    expect(generateWorkspace).toHaveBeenCalledWith("ws-1", {
      runtimeContract: null,
      directClient: true,
    })
    expect(engine.createContainer).not.toHaveBeenCalled()
    expect(engine.start).not.toHaveBeenCalled()
  })

  it("terminal destroy removes the container and the named volume", async () => {
    const { engine, calls } = fakeEngine()
    __setDockerControlForTests(engine)

    await destroyDockerWorkspace({ id: "ws-1", containerId: "ctr-1" })

    expect(calls).toEqual([
      { op: "remove", arg: "ctr-1" },
      { op: "removeVolume", arg: "claws-ws-1" },
    ])
  })
})
