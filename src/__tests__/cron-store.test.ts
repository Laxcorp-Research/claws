import { describe, it, expect } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import zlib from "node:zlib"

describe("R16 canonical cron store (jobs.json, not sqlite)", () => {
  it("upserts by job id and removes stale Claws-managed jobs, keeps plugin jobs", async () => {
    const mod = await import("../../container/cron-store.mjs")
    const existing = [
      { id: "heartbeat-orch-hourly", schedule: { kind: "cron", expr: "0 * * * *" } },
      { id: "heartbeat-orch-old", schedule: { kind: "cron", expr: "0 0 * * *" } },
      { id: "plugin-dreaming-1", schedule: { kind: "cron", expr: "0 3 * * *" } },
    ]
    const desired = [
      { id: "heartbeat-orch-hourly", schedule: { kind: "cron", expr: "0 */6 * * *" } },
    ]
    const next = mod.upsertCronJobsById(existing, desired)
    expect(next.map((j: { id: string }) => j.id)).toEqual([
      "heartbeat-orch-hourly",
      "plugin-dreaming-1",
    ])
    expect(next[0].schedule.expr).toBe("0 */6 * * *")
  })

  it("empty desired removes stale heartbeat jobs", async () => {
    const mod = await import("../../container/cron-store.mjs")
    const next = mod.upsertCronJobsById(
      [{ id: "heartbeat-orch-hourly", schedule: { kind: "cron", expr: "0 * * * *" } }],
      [],
    )
    expect(next).toEqual([])
  })

  it("reemitCanonicalCronStore writes CLAWS_FILES cron/jobs.json including []", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "claws-cron-store-"))
    try {
      fs.mkdirSync(path.join(dir, "cron"), { recursive: true })
      fs.writeFileSync(
        path.join(dir, "cron", "jobs.json"),
        JSON.stringify([{ id: "heartbeat-old", schedule: { kind: "cron", expr: "0 * * * *" } }]),
      )
      const files = { "cron/jobs.json": JSON.stringify([{ id: "heartbeat-new", schedule: { kind: "cron", expr: "0 */6 * * *" } }]) }
      const env = {
        ...process.env,
        CLAWS_FILES_GZ_B64: zlib.gzipSync(Buffer.from(JSON.stringify(files))).toString("base64"),
      }
      const mod = await import("../../container/cron-store.mjs")
      const result = mod.reemitCanonicalCronStore({ dataDir: dir, env })
      expect(result.wrote).toBe(true)
      const written = JSON.parse(fs.readFileSync(path.join(dir, "cron", "jobs.json"), "utf8")) as Array<{
        id: string
        schedule: { expr: string }
      }>
      expect(written).toEqual([
        { id: "heartbeat-new", schedule: { kind: "cron", expr: "0 */6 * * *" } },
      ])
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
