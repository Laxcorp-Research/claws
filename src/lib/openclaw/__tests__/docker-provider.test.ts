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
    "openclaw.json": "{}",
    ".env": "",
  }),
}))

import {
  __setDockerControlForTests,
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
      return { running: true, publishedPort: 32768 }
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
  delete process.env.CLAWS_DOCKER_PUBLISH
  delete process.env.CLAWS_DOCKER_PROXY_HOST
  process.env.CLAWS_DOCKER_NETWORK = "claws"
  ;(prismaMock.workspace.findUniqueOrThrow as MockFn).mockResolvedValue(workspace())
  ;(prismaMock.workspace.update as MockFn).mockResolvedValue({})
  ;(prismaMock.containerState.upsert as MockFn).mockResolvedValue({})
  ;(prismaMock.deployment.findFirst as MockFn).mockResolvedValue(null)
  ;(prismaMock.deployment.create as MockFn).mockResolvedValue({ id: "dep-1" })
  ;(prismaMock.deployment.update as MockFn).mockResolvedValue({})
})

afterEach(() => {
  __setDockerControlForTests(null)
  delete process.env.CLAWS_DOCKER_IMAGE
  delete process.env.CLAWS_DOCKER_PUBLISH
  delete process.env.CLAWS_DOCKER_PROXY_HOST
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
