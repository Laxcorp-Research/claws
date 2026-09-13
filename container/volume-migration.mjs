/**
 * 9.4 wake-path volume heal: run `openclaw doctor --fix` BEFORE gateway start
 * so leftover sessions.json converts to sqlite.
 *
 * 9.4 `assertSessionStoreMigrationComplete` throws if a non-sqlite session
 * store (sessions.json) remains. Leftover jsonl after import is archive, not
 * a boot refuse.
 *
 * Generator emit sets OPENCLAW_CONFIG_READONLY=1 so the gateway cannot rewrite
 * openclaw.json. 9.4 doctor --fix still aborts the whole command under that
 * env. Wake unsets the flag for this spawn only, then restores generator-owned
 * openclaw.json if doctor mutated it.
 *
 * Ledger: eventKind=runtime_volume_migration (registry: runtime-volume-migration).
 * soakCounts=false - first-wake conversion is not a soak defect.
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

function hasSessionsIndex(sessionsDir) {
  try {
    return fs.readdirSync(sessionsDir, { withFileTypes: true }).some(
      (ent) => ent.isFile() && ent.name === "sessions.json",
    )
  } catch {
    return false
  }
}

/**
 * True when this data dir still has a 5.22-shaped session store that 9.4 will
 * refuse (SessionStoreMigrationRequiredError), or leftover workspace-setup
 * files that 9.4 gates with StartupMaintenanceRequiredError (exit 78).
 *
 * cron/jobs.json is not boot-blocking on 9.4: the runtime still loads that
 * file. Treating leftover jobs.json as a refuse (when doctor converted
 * sessions.json) crash-looped the Twitter soak on 2026.9.4-1
 * (leftover=cron-json, gateway never started).
 *
 * Workspace setup: 9.4 doctor --fix often leaves
 * workspace-<agent>/openclaw-workspace-state.json (upstream 8.x/9.x gap). After
 * doctor we archive those files so gateway can start. soakCounts=false.
 */
export function listWorkspaceSetupLegacyFiles(dataDir) {
  const files = []
  if (!dataDir) return files

  const pushIfFile = (filePath) => {
    try {
      if (fs.statSync(filePath).isFile()) files.push(filePath)
    } catch {
      /* missing */
    }
  }

  try {
    for (const ent of fs.readdirSync(dataDir, { withFileTypes: true })) {
      if (ent.isDirectory() && ent.name.startsWith("workspace-")) {
        const ws = path.join(dataDir, ent.name)
        pushIfFile(path.join(ws, "openclaw-workspace-state.json"))
        pushIfFile(path.join(ws, ".openclaw", "workspace-state.json"))
        pushIfFile(`${ws}.attested`)
        pushIfFile(`${ws}.attested.doctor-importing`)
      }
    }
  } catch {
    /* missing dataDir */
  }

  const attDir = path.join(dataDir, "workspace-attestations")
  try {
    for (const ent of fs.readdirSync(attDir, { withFileTypes: true })) {
      if (
        ent.isFile() &&
        (ent.name.endsWith(".attested") || ent.name.endsWith(".attested.doctor-importing"))
      ) {
        files.push(path.join(attDir, ent.name))
      }
    }
  } catch {
    /* no attestation dir */
  }

  return files
}

export function archiveWorkspaceSetupLegacy(dataDir, nowMs = Date.now()) {
  const files = listWorkspaceSetupLegacyFiles(dataDir)
  if (files.length === 0) return { archived: [] }
  const destRoot = path.join(
    dataDir,
    ".claws",
    "archive",
    "workspace-setup",
    String(nowMs),
  )
  fs.mkdirSync(destRoot, { recursive: true })
  const archived = []
  for (const src of files) {
    const rel = path.relative(dataDir, src)
    const dest = path.join(destRoot, rel)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.renameSync(src, dest)
    archived.push(rel.replaceAll("\\", "/"))
  }
  return { archived }
}

export function listExecApprovalsLegacyFiles(dataDir) {
  const files = []
  if (!dataDir) return files
  for (const name of ["exec-approvals.json", "exec-approvals.sock"]) {
    const filePath = path.join(dataDir, name)
    try {
      const st = fs.lstatSync(filePath)
      if (st.isFile() || st.isSocket() || st.isSymbolicLink()) files.push(filePath)
    } catch {
      /* missing */
    }
  }
  return files
}

export function archiveExecApprovalsLegacy(dataDir, nowMs = Date.now()) {
  const files = listExecApprovalsLegacyFiles(dataDir)
  if (files.length === 0) return { archived: [] }
  const destRoot = path.join(dataDir, ".claws", "archive", "exec-approvals", String(nowMs))
  fs.mkdirSync(destRoot, { recursive: true })
  const archived = []
  for (const src of files) {
    const rel = path.relative(dataDir, src).replaceAll("\\", "/")
    const dest = path.join(destRoot, path.basename(src))
    try {
      fs.renameSync(src, dest)
    } catch {
      fs.rmSync(src, { force: true })
    }
    archived.push(rel)
  }
  return { archived }
}

export function detectLegacyRuntimeVolume(dataDir) {
  const reasons = []
  if (!dataDir) return { legacy: false, reasons }

  for (const agentId of listAgentIds(dataDir)) {
    const sessionsDir = path.join(dataDir, "agents", agentId, "sessions")
    if (hasSessionsIndex(sessionsDir)) {
      reasons.push(`sessions.json:${agentId}`)
    }
  }

  for (const filePath of listWorkspaceSetupLegacyFiles(dataDir)) {
    reasons.push(`workspace-setup:${path.relative(dataDir, filePath).replaceAll("\\", "/")}`)
  }

  return { legacy: reasons.length > 0, reasons }
}

function leftoverSessionReasons(reasons) {
  return reasons.filter((r) => r.startsWith("sessions.json:"))
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

function snapshotOpenclawJson(dataDir) {
  const filePath = path.join(dataDir, "openclaw.json")
  try {
    return { filePath, body: fs.readFileSync(filePath, "utf8") }
  } catch {
    return null
  }
}

function restoreOpenclawJson(snapshot) {
  if (!snapshot) return false
  fs.writeFileSync(snapshot.filePath, snapshot.body, "utf8")
  return true
}

function doctorSpawnEnv(env, dataDir) {
  const spawnEnv = {
    ...env,
    OPENCLAW_STATE_DIR: dataDir,
    OPENCLAW_DATA_DIR: dataDir,
  }
  // 9.4 doctor --fix exits 1 immediately under these flags (config-immutable).
  delete spawnEnv.OPENCLAW_CONFIG_READONLY
  delete spawnEnv.OPENCLAW_NIX_MODE
  return spawnEnv
}

function spawnDoctor(spawnSyncImpl, { appDir, env, dataDir, doctorArgs }) {
  return spawnSyncImpl("node", ["openclaw.mjs", "doctor", ...doctorArgs], {
    cwd: appDir,
    env: doctorSpawnEnv(env, dataDir),
    encoding: "utf8",
    timeout: DOCTOR_FIX_TIMEOUT_MS,
  })
}

function doctorExitStatus(result) {
  if (typeof result?.status === "number") return result.status
  if (result?.error) return 1
  return 0
}

/**
 * @param {object} args
 * @param {string} args.dataDir
 * @param {string} args.appDir
 * @param {Function} [args.spawnSyncImpl]
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

  // --non-interactive: wake has no TTY. CONFIG_READONLY is unset for this
  // spawn so session/cron sqlite import can run; generator-owned openclaw.json
  // is snapshotted and restored afterward.
  const configSnapshot = snapshotOpenclawJson(dataDir)
  const spawnArgs = { appDir, env, dataDir }
  let result
  try {
    result = spawnDoctor(spawnSyncImpl, {
      ...spawnArgs,
      doctorArgs: ["--fix", "--non-interactive", "--yes"],
    })
    if (result?.error) {
      throw new Error(
        `openclaw doctor --fix failed to spawn: ${result.error.message}`,
      )
    }
    // 8.1+ doctor --fix sometimes skips per-agent sessions.json. Targeted
    // import is the documented recovery; still restore generator config after.
    if (leftoverSessionReasons(detectLegacyRuntimeVolume(dataDir).reasons).length > 0) {
      result = spawnDoctor(spawnSyncImpl, {
        ...spawnArgs,
        doctorArgs: ["--session-sqlite", "import", "--session-sqlite-all-agents"],
      })
      if (result?.error) {
        throw new Error(
          `openclaw doctor --session-sqlite import failed to spawn: ${result.error.message}`,
        )
      }
    }
  } finally {
    restoreOpenclawJson(configSnapshot)
  }

  const doctorStatus = doctorExitStatus(result)

  const event = buildVolumeMigrationLedgerEvent({
    reasons: detected.reasons,
    doctorStatus,
    nowMs,
  })
  if (typeof ledger === "function") {
    await ledger(event)
  }

  const leftover = detectLegacyRuntimeVolume(dataDir)
  const sessionLeftover = leftoverSessionReasons(leftover.reasons)
  if (sessionLeftover.length > 0) {
    const stderr = typeof result?.stderr === "string" ? result.stderr.slice(0, 2000) : ""
    throw new Error(
      `openclaw doctor --fix left a legacy volume (exit ${doctorStatus}; leftover=${sessionLeftover.join(", ")}; before=${detected.reasons.join(", ")})${stderr ? `: ${stderr}` : ""}`,
    )
  }
  const archived = archiveWorkspaceSetupLegacy(dataDir, nowMs)

  return {
    ran: true,
    reason: "doctor-fix",
    reasons: detected.reasons,
    doctorStatus,
    archivedWorkspaceSetup: archived.archived,
    ledgerEvent: event,
  }
}
