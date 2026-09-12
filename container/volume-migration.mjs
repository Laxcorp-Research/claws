/**
 * 9.4 wake-path volume heal: run `openclaw doctor --fix` BEFORE gateway start
 * so leftover sessions.json / jsonl stores and cron JSON convert to sqlite.
 *
 * 9.4 `assertSessionStoreMigrationComplete` throws if a non-sqlite session
 * store remains. Doctor must finish (or we refuse boot). Generator-owned
 * openclaw.json stays read-only via OPENCLAW_CONFIG_READONLY=1 — doctor is
 * allowed to migrate runtime state, not rewrite our emit.
 *
 * Ledger: eventKind=runtime_volume_migration (registry: runtime-volume-migration).
 * soakCounts=false — first-wake conversion is not a soak defect.
 */

import fs from "node:fs"
import path from "node:path"
import { spawnSync } from "node:child_process"
import {
  RUNTIME_VOLUME_MIGRATION_EVENT_KIND,
  RUNTIME_VOLUME_MIGRATION_REGISTRY,
  HEAL_REGISTRY,
} from "./heal-registry.mjs"

export const DOCTOR_FIX_TIMEOUT_MS = 120_000

export function agentSqlitePath(dataDir, agentId) {
  return path.join(dataDir, "agents", agentId, "agent", "openclaw-agent.sqlite")
}

function listAgentIds(dataDir) {
  const root = path.join(dataDir, "agents")
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  } catch {
    return []
  }
}

function hasJsonlOrSessionsIndex(sessionsDir) {
  let entries
  try {
    entries = fs.readdirSync(sessionsDir, { withFileTypes: true })
  } catch {
    return { sessionsJson: false, jsonl: false }
  }
  let sessionsJson = false
  let jsonl = false
  for (const ent of entries) {
    if (!ent.isFile()) continue
    if (ent.name === "sessions.json") sessionsJson = true
    if (ent.name.endsWith(".jsonl") && !ent.name.includes(".jsonl.")) jsonl = true
  }
  return { sessionsJson, jsonl }
}

/**
 * True when this data dir still has a 5.22-shaped session or cron store that
 * 9.4 will refuse (or that doctor --fix is responsible for converting).
 */
export function detectLegacyRuntimeVolume(dataDir) {
  const reasons = []
  if (!dataDir) return { legacy: false, reasons }

  for (const agentId of listAgentIds(dataDir)) {
    const sessionsDir = path.join(dataDir, "agents", agentId, "sessions")
    const sqlite = agentSqlitePath(dataDir, agentId)
    const sqlitePresent = fs.existsSync(sqlite)
    const { sessionsJson, jsonl } = hasJsonlOrSessionsIndex(sessionsDir)
    if (sessionsJson) {
      reasons.push(`sessions.json:${agentId}`)
    }
    if (jsonl && !sqlitePresent) {
      reasons.push(`jsonl-without-sqlite:${agentId}`)
    }
  }

  const cronJson = path.join(dataDir, "cron", "jobs.json")
  const cronSqliteCandidates = [
    path.join(dataDir, "cron", "cron.sqlite"),
    path.join(dataDir, "cron", "jobs.sqlite"),
    path.join(dataDir, "cron", "openclaw-cron.sqlite"),
  ]
  const cronSqlitePresent = cronSqliteCandidates.some((p) => fs.existsSync(p))
  if (fs.existsSync(cronJson) && !cronSqlitePresent) {
    reasons.push("cron-json")
  }

  return { legacy: reasons.length > 0, reasons }
}

export function buildVolumeMigrationLedgerEvent({ reasons, doctorStatus, nowMs = Date.now() }) {
  return {
    type: "TASK_START",
    timestamp: new Date(nowMs).toISOString(),
    agentId: null,
    runId: null,
    sessionKey: null,
    channelId: null,
    action: "Runtime volume migration (jsonl/cron JSON → sqlite)",
    detail: `reasons=${reasons.join(",")} doctorStatus=${doctorStatus}`,
    metadata: {
      eventKind: RUNTIME_VOLUME_MIGRATION_EVENT_KIND,
      registry: RUNTIME_VOLUME_MIGRATION_REGISTRY,
      soakCounts: HEAL_REGISTRY[RUNTIME_VOLUME_MIGRATION_EVENT_KIND].soakCounts,
      reasons,
      doctorStatus,
    },
  }
}

/**
 * @param {object} args
 * @param {string} args.dataDir
 * @param {string} args.appDir
 * @param {typeof spawnSync} [args.spawnSyncImpl]
 * @param {(event: object) => Promise<unknown>|unknown} [args.ledger]
 * @param {number} [args.nowMs]
 * @param {NodeJS.ProcessEnv} [args.env]
 */
export async function runRuntimeVolumeMigration(args) {
  const {
    dataDir,
    appDir,
    spawnSyncImpl = spawnSync,
    ledger,
    nowMs = Date.now(),
    env = process.env,
  } = args

  const detected = detectLegacyRuntimeVolume(dataDir)
  if (!detected.legacy) {
    return { ran: false, reason: "not-legacy", reasons: [] }
  }

  // --non-interactive: wake has no TTY. Safe session/cron sqlite migrations
  // still run; we do not want doctor rewriting generator-owned openclaw.json
  // (OPENCLAW_CONFIG_READONLY=1). Config-write refusals must not block boot
  // if the volume is no longer legacy.
  const result = spawnSyncImpl(
    "node",
    ["openclaw.mjs", "doctor", "--fix", "--non-interactive"],
    {
      cwd: appDir,
      env: { ...env, OPENCLAW_STATE_DIR: dataDir, OPENCLAW_DATA_DIR: dataDir },
      encoding: "utf8",
      timeout: DOCTOR_FIX_TIMEOUT_MS,
    },
  )

  const doctorStatus =
    typeof result.status === "number"
      ? result.status
      : result.error
        ? 1
        : 0

  const event = buildVolumeMigrationLedgerEvent({
    reasons: detected.reasons,
    doctorStatus,
    nowMs,
  })
  if (typeof ledger === "function") {
    await ledger(event)
  }

  if (result.error) {
    throw new Error(
      `openclaw doctor --fix failed to spawn: ${result.error.message}`,
    )
  }

  const leftover = detectLegacyRuntimeVolume(dataDir)
  if (leftover.legacy) {
    const stderr = typeof result.stderr === "string" ? result.stderr.slice(0, 2000) : ""
    throw new Error(
      `openclaw doctor --fix left a legacy volume (exit ${doctorStatus}; leftover=${leftover.reasons.join(", ")}; before=${detected.reasons.join(", ")})${stderr ? `: ${stderr}` : ""}`,
    )
  }

  return {
    ran: true,
    reason: "doctor-fix",
    reasons: detected.reasons,
    doctorStatus,
    ledgerEvent: event,
  }
}
