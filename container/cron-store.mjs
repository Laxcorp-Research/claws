/**
 * R16: 9.4 cron canonical store is cron/jobs.json (plus jobs-state.json).
 * Not sqlite. Overlay re-emits from CLAWS_FILES after restore so every
 * deploy upserts by job id and drops stale Claws-managed jobs.
 */

import fs from "fs"
import path from "path"
import zlib from "zlib"

export const CANONICAL_CRON_REL = "cron/jobs.json"

export function parseCronJobsJson(raw) {
  const parsed = JSON.parse(raw)
  if (Array.isArray(parsed)) return parsed
  if (parsed && typeof parsed === "object" && Array.isArray(parsed.jobs)) {
    return parsed.jobs
  }
  return []
}

export function isClawsManagedCronJobId(id) {
  if (typeof id !== "string") return false
  return id.startsWith("heartbeat-") || id.startsWith("task-")
}

export function upsertCronJobsById(existing, desired) {
  const desiredList = (Array.isArray(desired) ? desired : []).filter(
    (job) => job && typeof job.id === "string" && job.id.length > 0,
  )
  const desiredIds = new Set(desiredList.map((job) => job.id))
  const kept = (Array.isArray(existing) ? existing : []).filter((job) => {
    if (!job || typeof job.id !== "string") return false
    if (desiredIds.has(job.id)) return false
    if (isClawsManagedCronJobId(job.id)) return false
    return true
  })
  return [...desiredList, ...kept]
}

export function jobsJsonFromClawsFilesEnv(env = process.env) {
  try {
    let decoded
    if (env.CLAWS_FILES_GZ_B64) {
      decoded = zlib.gunzipSync(Buffer.from(env.CLAWS_FILES_GZ_B64, "base64")).toString("utf8")
    } else if (env.CLAWS_FILES_B64) {
      decoded = Buffer.from(env.CLAWS_FILES_B64, "base64").toString("utf8")
    } else {
      return null
    }
    const files = JSON.parse(decoded)
    if (!files || typeof files !== "object") return null
    const raw = files[CANONICAL_CRON_REL]
    return typeof raw === "string" ? raw : null
  } catch {
    return null
  }
}

/**
 * @param {{ dataDir?: string, env?: NodeJS.ProcessEnv }} [args]
 */
export function reemitCanonicalCronStore(args = {}) {
  const { dataDir, env = process.env } = args
  if (!dataDir) return { wrote: false, reason: "no-data-dir" }
  const raw = jobsJsonFromClawsFilesEnv(env)
  if (raw === null) {
    return { wrote: false, reason: "no-claws-files-cron" }
  }

  let desired
  try {
    desired = parseCronJobsJson(raw)
  } catch {
    return { wrote: false, reason: "invalid-claws-files-cron" }
  }

  const storePath = path.join(dataDir, "cron", "jobs.json")
  let existing = []
  try {
    existing = parseCronJobsJson(fs.readFileSync(storePath, "utf8"))
  } catch {
    existing = []
  }

  const next = upsertCronJobsById(existing, desired)
  const nextIds = new Set(next.map((job) => job.id))
  const removed = existing.filter((job) => job?.id && !nextIds.has(job.id)).length
  fs.mkdirSync(path.dirname(storePath), { recursive: true })
  fs.writeFileSync(storePath, JSON.stringify(next, null, 2), "utf8")
  return {
    wrote: true,
    desired: desired.filter((job) => job && typeof job.id === "string").length,
    kept: next.length - desired.filter((job) => job && typeof job.id === "string").length,
    removed,
    total: next.length,
  }
}
