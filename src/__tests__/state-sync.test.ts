// PR-1: tests for the shared container state-sync module
// (container/state-sync.mjs) — Blob-only transport (token → put → finalize).

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
  vi.resetModules()
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

function blobHappyFetch(finalizeBody: Record<string, unknown> = { success: true, count: 1 }) {
  return vi.fn(async (url: string) => {
    const u = String(url)
    if (u.includes("/blob-token")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          pathname: "runtime-state/ws-test/x.gz",
          clientToken: "client-token",
          storeId: "storeTEST",
          apiUrl: "https://vercel.com/api/blob",
        }),
      }
    }
    if (u.includes("vercel.com/api/blob")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          url: "https://storeTEST.public.blob.vercel-storage.com/runtime-state/ws-test/x.gz",
        }),
        text: async () => "",
      }
    }
    if (u.includes("/finalize")) {
      return { ok: true, status: 200, json: async () => finalizeBody }
    }
    if (u.includes("/state/upload")) {
      throw new Error("legacy /upload must not be called — Blob-only transport")
    }
    throw new Error(`unexpected fetch ${u}`)
  })
}

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
      expect(keys.some((k: string) => k.startsWith("cron/"))).toBe(false)
      expect(keys.some((k: string) => k.startsWith("node_modules/"))).toBe(false)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("runStateSync — Blob-only status mapping", () => {
  const nonEmptyBundle = () => ({ files: { "agents/main/sessions/s1.jsonl": "e30=" }, totalSize: 2 })

  it("status 'persisted' when finalize confirms count>=1", async () => {
    const fetchImpl = blobHappyFetch({ success: true, count: 1 })
    const r = await mod.runStateSync({ bundleFn: nonEmptyBundle, fetchImpl })
    expect(r.status).toBe("persisted")
    expect(r.count).toBe(1)
    expect(r.path).toBe("blob")
  })

  it("status 'rejected' when finalize accepts but count===0 (row missing)", async () => {
    const fetchImpl = blobHappyFetch({ success: true, count: 0 })
    const r = await mod.runStateSync({ bundleFn: nonEmptyBundle, fetchImpl })
    expect(r.status).toBe("rejected")
    expect(r.count).toBe(0)
  })

  it("status 'rejected' (with httpStatus) when blob-token returns non-ok", async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).includes("/blob-token")) {
        return { ok: false, status: 503, json: async () => ({}) }
      }
      throw new Error("unexpected " + url)
    })
    const r = await mod.runStateSync({ bundleFn: nonEmptyBundle, fetchImpl })
    expect(r.status).toBe("rejected")
    expect(r.httpStatus).toBe(503)
  })

  it("status 'error' when the first fetch throws", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"))
    const r = await mod.runStateSync({ bundleFn: nonEmptyBundle, fetchImpl })
    expect(r.status).toBe("error")
  })

  it("always uses blob-token → put → finalize (never legacy /upload)", async () => {
    const fetchImpl = blobHappyFetch()
    const r = await mod.runStateSync({ bundleFn: nonEmptyBundle, fetchImpl })
    expect(r.status).toBe("persisted")
    const urls = fetchImpl.mock.calls.map((c: unknown[]) => String(c[0]))
    expect(urls.some((u: string) => u.includes("/blob-token"))).toBe(true)
    expect(urls.some((u: string) => u.includes("vercel.com/api/blob"))).toBe(true)
    expect(urls.some((u: string) => u.includes("/finalize"))).toBe(true)
    expect(urls.some((u: string) => u.includes("/state/upload"))).toBe(false)
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
    const uploadGate = new Promise((res) => {
      releaseUpload = res
    })
    const bundleFn = vi.fn(() => ({ files: { "agents/main/sessions/s1.jsonl": "e30=" }, totalSize: 2 }))
    const base = blobHappyFetch()
    const fetchImpl = vi.fn(async (url: string) => {
      await uploadGate
      return base(url)
    })

    const p1 = mod.runStateSync({ bundleFn, fetchImpl })
    const p2 = mod.runStateSync({ bundleFn, fetchImpl })
    expect(mod.__isSyncInFlight()).toBe(true)

    releaseUpload(undefined)
    const [r1, r2] = await Promise.all([p1, p2])

    expect(bundleFn).toHaveBeenCalledTimes(1)
    expect(r1).toBe(r2)
    expect(r1.status).toBe("persisted")
    expect(mod.__isSyncInFlight()).toBe(false)
  })

  it("a fresh call after completion starts a new sync (guard clears)", async () => {
    const bundleFn = vi.fn(() => ({ files: { a: "e30=" }, totalSize: 2 }))
    const fetchImpl = blobHappyFetch()
    await mod.runStateSync({ bundleFn, fetchImpl })
    await mod.runStateSync({ bundleFn, fetchImpl })
    // Each sync: blob-token + put + finalize = 3 fetches
    expect(fetchImpl).toHaveBeenCalledTimes(6)
  })
})

describe("bundle hygiene — live-set filter (PR-2 -8)", () => {
  const LIVE_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
  const LIVE_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
  const LIVE_C = "cccccccc-cccc-cccc-cccc-cccccccccccc"
  const ORPHAN = "dddddddd-dddd-dddd-dddd-dddddddddddd"

  function writeSessionsTree(root: string) {
    const sess = path.join(root, "agents", "main", "sessions")
    fs.mkdirSync(sess, { recursive: true })
    const index = {
      "agent:main:a": { sessionId: LIVE_A },
      "agent:main:b": { sessionId: LIVE_B },
      "agent:main:c": { sessionId: LIVE_C },
    }
    fs.writeFileSync(path.join(sess, "sessions.json"), JSON.stringify(index))
    for (const id of [LIVE_A, LIVE_B, LIVE_C, ORPHAN]) {
      fs.writeFileSync(path.join(sess, `${id}.jsonl`), `{"id":"${id}"}\n`)
      fs.writeFileSync(path.join(sess, `${id}.trajectory.jsonl`), "{}\n")
      fs.writeFileSync(path.join(sess, `${id}.trajectory-path.json`), "{}")
    }
    fs.writeFileSync(
      path.join(sess, `${ORPHAN}.jsonl.reset.2026-01-01T00-00-00`),
      "reset-bytes",
    )
    fs.mkdirSync(path.join(root, "workspace-main"), { recursive: true })
    fs.writeFileSync(path.join(root, "workspace-main", "MEMORY.md"), "# mem")
  }

  it("MUTATION-anchored: ships live trio + sessions.json; excludes orphan + reset", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claws-hygiene-"))
    try {
      writeSessionsTree(dir)
      const { files } = mod.bundleRuntimeState(dir)
      const keys = Object.keys(files)

      expect(keys).toContain("agents/main/sessions/sessions.json")
      for (const id of [LIVE_A, LIVE_B, LIVE_C]) {
        expect(keys).toContain(`agents/main/sessions/${id}.jsonl`)
        expect(keys).toContain(`agents/main/sessions/${id}.trajectory.jsonl`)
        expect(keys).toContain(`agents/main/sessions/${id}.trajectory-path.json`)
      }
      // Dropping the live-set gate (always include) fails these:
      expect(keys).not.toContain(`agents/main/sessions/${ORPHAN}.jsonl`)
      expect(keys).not.toContain(`agents/main/sessions/${ORPHAN}.trajectory.jsonl`)
      expect(keys.some((k: string) => k.includes(".jsonl.reset."))).toBe(false)
      expect(keys).toContain("workspace-main/MEMORY.md")
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("MUTATION-anchored: agent with NO sessions.json ships everything (fail-open)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claws-hygiene-fo-"))
    try {
      const sess = path.join(dir, "agents", "orphan-agent", "sessions")
      fs.mkdirSync(sess, { recursive: true })
      fs.writeFileSync(path.join(sess, `${ORPHAN}.jsonl`), "{}\n")
      fs.writeFileSync(path.join(sess, `${ORPHAN}.jsonl.reset.x`), "r")
      // No sessions.json — dropping fail-open (treat as empty live set) fails.
      const { files } = mod.bundleRuntimeState(dir)
      const keys = Object.keys(files)
      expect(keys).toContain(`agents/orphan-agent/sessions/${ORPHAN}.jsonl`)
      expect(keys).toContain(`agents/orphan-agent/sessions/${ORPHAN}.jsonl.reset.x`)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("near-cap WARNING hysteresis (PR-2 -8)", () => {
  beforeEach(() => {
    mod.__resetNearCapHysteresis()
  })

  it("MUTATION-anchored: emits once at ≥80% of ABSOLUTE_MAX; no re-emit until below 70%", () => {
    const warnAt = mod.NEAR_CAP_WARN_BYTES
    const rearmBelow = mod.NEAR_CAP_REARM_BYTES
    expect(warnAt).toBe(Math.floor(mod.ABSOLUTE_MAX_COMPRESSED_BYTES * 0.8))
    expect(rearmBelow).toBe(Math.floor(mod.ABSOLUTE_MAX_COMPRESSED_BYTES * 0.7))

    // Just under 80% — no emit. Dropping the ≥ check (always emit) would fail.
    expect(mod.evaluateNearCap(warnAt - 1).emit).toBe(false)

    // Cross 80% — emit once.
    expect(mod.evaluateNearCap(warnAt).emit).toBe(true)
    // Still above rearm band — suppressed.
    expect(mod.evaluateNearCap(warnAt + 1000).emit).toBe(false)
    expect(mod.evaluateNearCap(rearmBelow).emit).toBe(false)

    // Drop below 70% re-arms; next crossing emits again.
    expect(mod.evaluateNearCap(rearmBelow - 1).emit).toBe(false)
    expect(mod.__getNearCapArmed()).toBe(true)
    expect(mod.evaluateNearCap(warnAt).emit).toBe(true)
  })
})

describe("single source of truth (refactor-safety guard)", () => {
  const pm = readFileSync(resolve(process.cwd(), "container/process-manager.mjs"), "utf8")
  const plugin = readFileSync(resolve(process.cwd(), "container/claws-activity-reporter/index.mjs"), "utf8")

  it("process-manager imports runStateSync from the shared module and has NO inline bundle/upload", () => {
    expect(pm).toMatch(/from ['"]\.\/state-sync\.mjs['"]/)
    expect(pm).toContain("runStateSync")
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
