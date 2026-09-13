// -9: rebuild-index-from-disk (finding E runtime half).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { readFileSync } from "node:fs"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mod: any

beforeEach(async () => {
  vi.resetModules()
  mod = await import("../../container/state-sync.mjs")
})

describe("rebuildSessionsIndexFromDisk", () => {
  let dir: string

  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
  })

  it("reconstructs index when sessions.json missing and jsonl present (main=newest)", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "claws-rebuild-"))
    const sess = path.join(dir, "sessions")
    fs.mkdirSync(sess, { recursive: true })
    const older = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    const newer = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
    const olderPath = path.join(sess, `${older}.jsonl`)
    const newerPath = path.join(sess, `${newer}.jsonl`)
    fs.writeFileSync(olderPath, "{}\n")
    fs.writeFileSync(newerPath, "{}\n")
    const past = new Date("2026-01-01T00:00:00Z")
    const recent = new Date("2026-07-01T00:00:00Z")
    fs.utimesSync(olderPath, past, past)
    fs.utimesSync(newerPath, recent, recent)

    const result = mod.rebuildSessionsIndexFromDisk(sess, "orch")
    expect(result.rebuilt).toBe(true)
    expect(result.mainUuid).toBe(newer)
    expect(result.count).toBe(2)

    const index = JSON.parse(fs.readFileSync(path.join(sess, "sessions.json"), "utf8"))
    expect(index["agent:orch:main"]).toBe(newer)
    expect(index[`agent:orch:session:${older}`]).toBe(older)
    expect(mod.isMainSessionKey("agent:orch:main")).toBe(true)
  })

  it("idempotent no-op when index already present", () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "claws-rebuild-noop-"))
    const sess = path.join(dir, "sessions")
    fs.mkdirSync(sess, { recursive: true })
    const uuid = "cccccccc-cccc-cccc-cccc-cccccccccccc"
    fs.writeFileSync(
      path.join(sess, "sessions.json"),
      JSON.stringify({ "agent:orch:main": uuid }),
    )
    fs.writeFileSync(path.join(sess, `${uuid}.jsonl`), "{}\n")

    const result = mod.rebuildSessionsIndexFromDisk(sess, "orch")
    expect(result).toEqual(
      expect.objectContaining({ rebuilt: false, reason: "index-present" }),
    )
  })

  it("MUTATION: process-manager must call rebuildAllSessionsIndexesFromDisk (drop → fail)", () => {
    const src = readFileSync(
      path.join(process.cwd(), "container/process-manager.mjs"),
      "utf8",
    )
    expect(src).toContain("rebuildAllSessionsIndexesFromDisk")
  })
})
