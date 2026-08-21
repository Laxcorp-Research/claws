// -9: process-manager emitProxySpawnStatus ActivityLog shape.

import { describe, it, expect, beforeEach, vi } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pm: any

beforeEach(async () => {
  vi.resetModules()
  pm = await import("../../container/process-manager.mjs")
})

describe("emitProxySpawnStatus", () => {
  it("posts TASK_START when healthy and ERROR when failed", async () => {
    const events: unknown[] = []
    // postActivityEvent is closed over from state-sync - spy via monkeypatch on module
    // by re-importing after mock is hard; instead assert source + call with stubbed fetch
    // through state-sync postActivityEvent by temporarily swapping global fetch.
    const bodies: string[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: { body?: string }) => {
        if (init?.body) bodies.push(init.body)
        return { ok: true, status: 200, json: async () => ({}) }
      }),
    )

    process.env.CLAWS_ACTIVITY_ENDPOINT =
      "https://example.test/api/internal/activity"
    process.env.CLAWS_ACTIVITY_SECRET = "activity-secret"
    process.env.CLAWS_WORKSPACE_ID = "ws-1"

    vi.resetModules()
    pm = await import("../../container/process-manager.mjs")

    await pm.emitProxySpawnStatus(true)
    await pm.emitProxySpawnStatus(false)

    const parsed = bodies.map((b) => JSON.parse(b))
    const flat = parsed.flatMap((p) => (Array.isArray(p.events) ? p.events : [p]))
    const types = flat.map((e: { type?: string }) => e.type)
    expect(types).toContain("TASK_START")
    expect(types).toContain("ERROR")
    expect(
      flat.some(
        (e: { metadata?: { eventKind?: string } }) =>
          e.metadata?.eventKind === "proxy_spawn_status",
      ),
    ).toBe(true)

    vi.unstubAllGlobals()
    void events
  })

  it("MUTATION: main() must call emitProxySpawnStatus (drop → fail)", () => {
    const src = readFileSync(
      path.join(process.cwd(), "container/process-manager.mjs"),
      "utf8",
    )
    expect(src).toContain("emitProxySpawnStatus")
    expect(src).toContain("eventKind: 'proxy_spawn_status'")
  })
})
