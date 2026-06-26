// PR-1: tests for the shared container state-sync module
// (container/state-sync.mjs) — the single source of truth for bundling the
// OpenClaw data dir + uploading it, used by BOTH process-manager (interval/
// SIGTERM) and the gateway plugin's /internal/sync-now route.
//
// Lives under src/__tests__/ so vitest's include picks it up; the module is
// imported via a relative path (it's baked into the image, not the Next app).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mod: any

const ENV_KEYS = ["CLAWS_METERING_ENDPOINT", "CLAWS_METERING_SECRET", "CLAWS_WORKSPACE_ID"] as const
const saved: Record<string, string | undefined> = {}

beforeEach(async () => {
  mod = await import("../../container/state-sync.mjs")
  for (const k of ENV_KEYS) saved[k] = process.env[k]
  process.env.CLAWS_METERING_ENDPOINT = "https://app.example/api/internal/metering"
  process.env.CLAWS_METERING_SECRET = "test-metering-secret"
  process.env.CLAWS_WORKSPACE_ID = "ws-test"
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe("bundleRuntimeState", () => {
  it("includes runtime files (sessions, MEMORY.md) and excludes config/node_modules/dot-dirs", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claws-state-"))
    try {
      fs.writeFileSync(path.join(dir, "openclaw.json"), "{}")
      fs.writeFileSync(path.join(dir, ".env"), "X=1")
      fs.mkdirSync(path.join(dir, "cron"), { recursive: true })
      fs.writeFileSync(path.join(dir, "cron", "jobs.json"), "[]")
      fs.mkdirSync(path.join(dir, "node_modules", "p"), { recursive: true })
      fs.writeFileSync(path.join(dir, "node_modules", "p", "x.js"), "1")
      fs.mkdirSync(path.join(dir, "agents", "main", "sessions"), { recursive: true })
      fs.writeFileSync(path.join(dir, "agents", "main", "sessions", "s1.jsonl"), "{}\n")
      fs.mkdirSync(path.join(dir, "workspace-orchestrator"), { recursive: true })
      fs.writeFileSync(path.join(dir, "workspace-orchestrator", "MEMORY.md"), "# mem")

      const { files } = mod.bundleRuntimeState(dir)
      const keys = Object.keys(files)
      expect(keys).toContain("agents/main/sessions/s1.jsonl")
      expect(keys).toContain("workspace-orchestrator/MEMORY.md")
      expect(keys).not.toContain("openclaw.json")
      expect(keys).not.toContain(".env")
      expect(keys.some((k) => k.startsWith("cron/"))).toBe(false)
      expect(keys.some((k) => k.startsWith("node_modules/"))).toBe(false)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("runStateSync — status mapping (the persist confirmation contract)", () => {
  const nonEmptyBundle = () => ({ files: { "agents/main/sessions/s1.jsonl": "e30=" }, totalSize: 2 })

  it("status 'persisted' when the server confirms count>=1", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, count: 1 }) })
    const r = await mod.runStateSync({ bundleFn: nonEmptyBundle, fetchImpl })
    expect(r.status).toBe("persisted")
    expect(r.count).toBe(1)
  })

  it("status 'rejected' when the server accepts but count===0 (row missing)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true, count: 0 }) })
    const r = await mod.runStateSync({ bundleFn: nonEmptyBundle, fetchImpl })
    expect(r.status).toBe("rejected")
    expect(r.count).toBe(0)
  })

  it("status 'rejected' (with httpStatus) when the server returns non-ok", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 413, json: async () => ({}) })
    const r = await mod.runStateSync({ bundleFn: nonEmptyBundle, fetchImpl })
    expect(r.status).toBe("rejected")
    expect(r.httpStatus).toBe(413)
  })

  it("status 'error' when the upload throws", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"))
    const r = await mod.runStateSync({ bundleFn: nonEmptyBundle, fetchImpl })
    expect(r.status).toBe("error")
  })

  it("status 'empty' when there are no runtime files (nothing to persist)", async () => {
    const fetchImpl = vi.fn()
    const r = await mod.runStateSync({ bundleFn: () => ({ files: {}, totalSize: 0 }), fetchImpl })
    expect(r.status).toBe("empty")
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("status 'unconfigured' when env is missing — nothing attempted", async () => {
    delete process.env.CLAWS_METERING_SECRET
    const fetchImpl = vi.fn()
    const r = await mod.runStateSync({ bundleFn: nonEmptyBundle, fetchImpl })
    expect(r.status).toBe("unconfigured")
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe("runStateSync — per-process in-flight guard", () => {
  it("coalesces concurrent callers into ONE bundle/upload; both resolve identically", async () => {
    let releaseUpload: (v: unknown) => void = () => {}
    const uploadGate = new Promise((res) => { releaseUpload = res })
    const bundleFn = vi.fn(() => ({ files: { "agents/main/sessions/s1.jsonl": "e30=" }, totalSize: 2 }))
    const fetchImpl = vi.fn(async () => {
      await uploadGate
      return { ok: true, status: 200, json: async () => ({ success: true, count: 1 }) }
    })

    const p1 = mod.runStateSync({ bundleFn, fetchImpl })
    const p2 = mod.runStateSync({ bundleFn, fetchImpl })
    expect(mod.__isSyncInFlight()).toBe(true)

    releaseUpload(undefined)
    const [r1, r2] = await Promise.all([p1, p2])

    // Mutation guard: remove the in-flight guard and these become 2 each.
    expect(bundleFn).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(r1).toBe(r2) // same resolved object — both awaited the one in-flight sync
    expect(r1.status).toBe("persisted")
    expect(mod.__isSyncInFlight()).toBe(false)
  })

  it("a fresh call after completion starts a new sync (guard clears)", async () => {
    const bundleFn = vi.fn(() => ({ files: { "a": "e30=" }, totalSize: 2 }))
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ count: 1 }) }))
    await mod.runStateSync({ bundleFn, fetchImpl })
    await mod.runStateSync({ bundleFn, fetchImpl })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})

describe("single source of truth (refactor-safety guard)", () => {
  const pm = readFileSync(resolve(process.cwd(), "container/process-manager.mjs"), "utf8")
  const plugin = readFileSync(resolve(process.cwd(), "container/claws-activity-reporter/index.mjs"), "utf8")

  it("process-manager imports runStateSync from the shared module and has NO inline bundle/upload", () => {
    expect(pm).toMatch(/from ['"]\.\/state-sync\.mjs['"]/)
    expect(pm).toContain("runStateSync")
    // The bundle/upload logic must NOT be duplicated back into process-manager:
    // no inline bundler, and no gzipSync( (the sync compression now lives only
    // in the shared module; process-manager keeps only gunzipSync for restore,
    // which does not contain the "gzipSync(" substring).
    expect(pm).not.toMatch(/function bundleRuntimeState/)
    expect(pm).not.toContain("gzipSync(")
  })

  it("the plugin imports runStateSync from the shared module and registers the sync-now route", () => {
    expect(plugin).toMatch(/from ['"]\.\.\/state-sync\.mjs['"]/)
    expect(plugin).toContain("runStateSync")
    expect(plugin).toContain("registerHttpRoute")
    expect(plugin).toContain("/internal/sync-now")
  })
})
