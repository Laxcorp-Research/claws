// -9: CLAWS_RETAIN_ORPHAN_SESSIONS (default true) + 5MB size guard.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { readFileSync } from "node:fs"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mod: any

const LIVE = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
const ORPHAN = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"

beforeEach(async () => {
  vi.resetModules()
  delete process.env.CLAWS_RETAIN_ORPHAN_SESSIONS
  mod = await import("../../container/state-sync.mjs")
})

afterEach(() => {
  delete process.env.CLAWS_RETAIN_ORPHAN_SESSIONS
})

describe("CLAWS_RETAIN_ORPHAN_SESSIONS", () => {
  it("default true keeps not-in-index jsonl; still drops reset leftovers", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claws-retain-"))
    try {
      const sess = path.join(dir, "agents", "main", "sessions")
      fs.mkdirSync(sess, { recursive: true })
      fs.writeFileSync(
        path.join(sess, "sessions.json"),
        JSON.stringify({ "agent:main:main": LIVE }),
      )
      fs.writeFileSync(path.join(sess, `${LIVE}.jsonl`), "live\n")
      fs.writeFileSync(path.join(sess, `${ORPHAN}.jsonl`), "orphan\n")
      fs.writeFileSync(path.join(sess, `${ORPHAN}.jsonl.reset.x`), "reset\n")

      expect(mod.retainOrphanSessionsEnabled()).toBe(true)
      const { files } = mod.bundleRuntimeState(dir)
      const keys = Object.keys(files)
      expect(keys).toContain(`agents/main/sessions/${LIVE}.jsonl`)
      expect(keys).toContain(`agents/main/sessions/${ORPHAN}.jsonl`)
      expect(keys.some((k: string) => k.includes(".jsonl.reset."))).toBe(false)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("flag=false restores drop-orphan hygiene", async () => {
    process.env.CLAWS_RETAIN_ORPHAN_SESSIONS = "false"
    vi.resetModules()
    mod = await import("../../container/state-sync.mjs")

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claws-drop-"))
    try {
      const sess = path.join(dir, "agents", "main", "sessions")
      fs.mkdirSync(sess, { recursive: true })
      fs.writeFileSync(
        path.join(sess, "sessions.json"),
        JSON.stringify({ "agent:main:main": LIVE }),
      )
      fs.writeFileSync(path.join(sess, `${LIVE}.jsonl`), "live\n")
      fs.writeFileSync(path.join(sess, `${ORPHAN}.jsonl`), "orphan\n")

      const { files } = mod.bundleRuntimeState(dir)
      expect(Object.keys(files)).not.toContain(`agents/main/sessions/${ORPHAN}.jsonl`)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("size-guard skips orphan jsonl >5MB", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claws-big-"))
    try {
      const sess = path.join(dir, "agents", "main", "sessions")
      fs.mkdirSync(sess, { recursive: true })
      fs.writeFileSync(
        path.join(sess, "sessions.json"),
        JSON.stringify({ "agent:main:main": LIVE }),
      )
      fs.writeFileSync(path.join(sess, `${LIVE}.jsonl`), "live\n")
      const big = Buffer.alloc(mod.ORPHAN_RETAIN_MAX_BYTES + 1, 0x61)
      fs.writeFileSync(path.join(sess, `${ORPHAN}.jsonl`), big)

      const { files } = mod.bundleRuntimeState(dir)
      expect(Object.keys(files)).toContain(`agents/main/sessions/${LIVE}.jsonl`)
      expect(Object.keys(files)).not.toContain(`agents/main/sessions/${ORPHAN}.jsonl`)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("MUTATION: shouldIncludeSessionArtifact must honor retainOrphans (drop → fail)", () => {
    const src = readFileSync(path.join(process.cwd(), "container/state-sync.mjs"), "utf8")
    expect(src).toContain("retainOrphanSessionsEnabled")
    expect(src).toContain("ORPHAN_RETAIN_MAX_BYTES")
    expect(src).toContain('CLAWS_RETAIN_ORPHAN_SESSIONS !== "false"')
  })
})
