import { describe, it, expect, vi } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { readFileSync } from "node:fs"

function migrateFs(dir: string, sessions: string) {
  fs.unlinkSync(path.join(sessions, "sessions.json"))
  fs.mkdirSync(path.join(dir, "agents", "orch", "agent"), { recursive: true })
  fs.writeFileSync(
    path.join(dir, "agents", "orch", "agent", "openclaw-agent.sqlite"),
    "sql",
  )
}

describe("runtime volume migration (jsonl → sqlite doctor --fix)", () => {
  it("detects sessions.json + jsonl-without-sqlite + cron JSON as legacy", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claws-volmig-"))
    try {
      const sessions = path.join(dir, "agents", "orch", "sessions")
      fs.mkdirSync(sessions, { recursive: true })
      fs.writeFileSync(path.join(sessions, "sessions.json"), "{}")
      fs.writeFileSync(
        path.join(sessions, "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jsonl"),
        "{}\n",
      )
      fs.mkdirSync(path.join(dir, "cron"), { recursive: true })
      fs.writeFileSync(path.join(dir, "cron", "jobs.json"), "[]")

      const mod = await import("../../container/volume-migration.mjs")
      const detected = mod.detectLegacyRuntimeVolume(dir)
      expect(detected.legacy).toBe(true)
      expect(detected.reasons).toEqual(
        expect.arrayContaining(["sessions.json:orch", "jsonl-without-sqlite:orch", "cron-json"]),
      )
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("skips doctor when sqlite store is already present and sessions.json is gone", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claws-volmig-sql-"))
    try {
      fs.mkdirSync(path.join(dir, "agents", "orch", "agent"), { recursive: true })
      fs.writeFileSync(
        path.join(dir, "agents", "orch", "agent", "openclaw-agent.sqlite"),
        "sql",
      )
      const mod = await import("../../container/volume-migration.mjs")
      const detected = mod.detectLegacyRuntimeVolume(dir)
      expect(detected.legacy).toBe(false)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("runs doctor --fix, ledgers runtime_volume_migration, soakCounts false", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claws-volmig-doc-"))
    try {
      const sessions = path.join(dir, "agents", "orch", "sessions")
      fs.mkdirSync(sessions, { recursive: true })
      fs.writeFileSync(path.join(sessions, "sessions.json"), "{}")

      const spawnSyncImpl = vi.fn((
        _cmd: string,
        _args: string[],
        opts: { env?: NodeJS.ProcessEnv },
      ) => {
        expect(opts.env?.OPENCLAW_CONFIG_READONLY).toBeUndefined()
        migrateFs(dir, sessions)
        return { status: 0, stderr: "", error: undefined }
      })
      const ledger = vi.fn(async () => ({ ok: true }))
      const mod = await import("../../container/volume-migration.mjs")
      const result = await mod.runRuntimeVolumeMigration({
        dataDir: dir,
        appDir: "/app",
        spawnSyncImpl,
        ledger,
        env: { ...process.env, OPENCLAW_CONFIG_READONLY: "1" },
      })
      expect(result.ran).toBe(true)
      expect(spawnSyncImpl).toHaveBeenCalledTimes(1)
      expect(spawnSyncImpl).toHaveBeenCalledWith(
        "node",
        ["openclaw.mjs", "doctor", "--fix", "--non-interactive"],
        expect.objectContaining({ cwd: "/app", timeout: 120_000 }),
      )
      expect(ledger).toHaveBeenCalledTimes(1)
      const event = (
        ledger.mock.calls[0] as unknown as [
          { metadata: { eventKind: string; registry: string; soakCounts: boolean } },
        ]
      )[0]
      expect(event.metadata.eventKind).toBe("runtime_volume_migration")
      expect(event.metadata.registry).toBe("runtime-volume-migration")
      expect(event.metadata.soakCounts).toBe(false)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("refuses boot (throws) when doctor --fix exits non-zero", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claws-volmig-fail-"))
    try {
      const sessions = path.join(dir, "agents", "orch", "sessions")
      fs.mkdirSync(sessions, { recursive: true })
      fs.writeFileSync(path.join(sessions, "sessions.json"), "{}")
      const spawnSyncImpl = vi.fn(() => ({
        status: 2,
        stderr: "SessionStoreMigrationRequiredError",
        error: undefined,
      }))
      const mod = await import("../../container/volume-migration.mjs")
      await expect(
        mod.runRuntimeVolumeMigration({
          dataDir: dir,
          appDir: "/app",
          spawnSyncImpl,
        }),
      ).rejects.toThrow(/left a legacy volume \(exit 2/)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("refuses boot when doctor exits 0 but sessions.json remains", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claws-volmig-noop-"))
    try {
      const sessions = path.join(dir, "agents", "orch", "sessions")
      fs.mkdirSync(sessions, { recursive: true })
      fs.writeFileSync(path.join(sessions, "sessions.json"), "{}")
      const spawnSyncImpl = vi.fn(() => ({ status: 0, stderr: "", error: undefined }))
      const mod = await import("../../container/volume-migration.mjs")
      await expect(
        mod.runRuntimeVolumeMigration({
          dataDir: dir,
          appDir: "/app",
          spawnSyncImpl,
        }),
      ).rejects.toThrow(/left a legacy volume/)
      expect(spawnSyncImpl).toHaveBeenCalledTimes(2)
      expect(spawnSyncImpl).toHaveBeenNthCalledWith(
        2,
        "node",
        ["openclaw.mjs", "doctor", "--session-sqlite", "import", "--session-sqlite-all-agents"],
        expect.objectContaining({ cwd: "/app" }),
      )
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("treats CONFIG_READONLY doctor non-zero as success when volume is no longer legacy", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claws-volmig-ro-"))
    try {
      const sessions = path.join(dir, "agents", "orch", "sessions")
      fs.mkdirSync(sessions, { recursive: true })
      fs.writeFileSync(path.join(sessions, "sessions.json"), "{}")
      const spawnSyncImpl = vi.fn(() => {
        migrateFs(dir, sessions)
        return { status: 1, stderr: "OPENCLAW_CONFIG_READONLY", error: undefined }
      })
      const mod = await import("../../container/volume-migration.mjs")
      const result = await mod.runRuntimeVolumeMigration({
        dataDir: dir,
        appDir: "/app",
        spawnSyncImpl,
      })
      expect(result.ran).toBe(true)
      expect(result.doctorStatus).toBe(1)
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("restores generator-owned openclaw.json after doctor mutates it", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claws-volmig-restore-"))
    try {
      const sessions = path.join(dir, "agents", "orch", "sessions")
      fs.mkdirSync(sessions, { recursive: true })
      fs.writeFileSync(path.join(sessions, "sessions.json"), "{}")
      const cfg = path.join(dir, "openclaw.json")
      fs.writeFileSync(cfg, '{"owned":true}')
      const spawnSyncImpl = vi.fn(() => {
        fs.writeFileSync(cfg, '{"mutated":true}')
        migrateFs(dir, sessions)
        return { status: 0, stderr: "", error: undefined }
      })
      const mod = await import("../../container/volume-migration.mjs")
      await mod.runRuntimeVolumeMigration({
        dataDir: dir,
        appDir: "/app",
        spawnSyncImpl,
      })
      expect(fs.readFileSync(cfg, "utf8")).toBe('{"owned":true}')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("MUTATION: process-manager must call runRuntimeVolumeMigration before spawnGateway", () => {
    const src = readFileSync(
      path.join(process.cwd(), "container/process-manager.mjs"),
      "utf8",
    )
    const migAt = src.indexOf("runRuntimeVolumeMigration")
    const spawnAt = src.indexOf("spawnGateway()")
    expect(migAt).toBeGreaterThan(0)
    expect(spawnAt).toBeGreaterThan(migAt)
    expect(src).toContain("process.exit(1)")
  })
})
