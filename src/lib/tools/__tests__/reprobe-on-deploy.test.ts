import { readFileSync } from "node:fs"
import { join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"

vi.mock("@/lib/db", () => ({ prisma: prismaMock }))
vi.mock("@/lib/logger", () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), toolEvent: vi.fn() },
}))

const mockProbe = vi.fn()
const mockLedger = vi.fn()
vi.mock("@/lib/tools/probe-api-key", async () => {
  const actual = await vi.importActual<typeof import("@/lib/tools/probe-api-key")>(
    "@/lib/tools/probe-api-key",
  )
  return {
    ...actual,
    probeAndPersistApiKeyConnection: (...args: unknown[]) => mockProbe(...args),
    ledgerToolStatusProbe: (...args: unknown[]) => mockLedger(...args),
  }
})

import { reprobeWorkspaceToolConnections } from "@/lib/tools/reprobe-on-deploy"

describe("reprobeWorkspaceToolConnections", () => {
  beforeEach(() => {
    mockProbe.mockReset()
    mockLedger.mockReset()
    mockLedger.mockResolvedValue(undefined)
    ;(prismaMock.toolConnection.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: "c1",
        workspaceId: "ws-1",
        toolSlug: "tavily",
        connectionType: "API_KEY",
        status: "ERROR",
        encryptedCredentials: "{}",
      },
    ])
  })

  it("re-probes API_KEY rows on deploy and ledgers the batch", async () => {
    mockProbe.mockResolvedValue({
      ok: true,
      result: {
        connectionId: "c1",
        toolSlug: "tavily",
        outcome: "connected",
        status: "CONNECTED",
        valid: true,
      },
    })
    const summary = await reprobeWorkspaceToolConnections("ws-1")
    expect(summary.probed).toBe(1)
    expect(summary.connected).toBe(1)
    expect(mockLedger).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws-1",
        trigger: "redeploy",
      }),
    )
  })

  it("MUTATION: generateWorkspace must call reprobe before baking TOOLS.md", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/openclaw/generator.ts"), "utf8")
    expect(src).toContain("reprobeWorkspaceToolConnections")
    const idxProbe = src.indexOf("reprobeWorkspaceToolConnections")
    const idxLoad = src.indexOf("prisma.workspace.findUniqueOrThrow")
    expect(idxProbe).toBeGreaterThan(-1)
    expect(idxLoad).toBeGreaterThan(idxProbe)
  })
})
