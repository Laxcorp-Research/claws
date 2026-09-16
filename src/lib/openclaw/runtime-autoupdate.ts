import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { sendOwnerAlert } from "@/lib/alerts/owner-alert"
import { resolvePublicAppUrl } from "@/lib/alerts/app-url"
import { neverPromotableReason } from "@/lib/openclaw/version-hygiene"
import {
  classifyRuntimeBump,
  mayAutoPromoteOverlayN,
  STALE_CANDIDATE_MS,
  STALE_PING_COOLDOWN_MS,
  type RuntimeBumpClass,
} from "@/lib/openclaw/runtime-bump"

export type CandidateRow = {
  id: string
  version: string
  buildSourceTag: string | null
  dockerImage: string
  isStable: boolean
  isLatest: boolean
  supersededAt: Date | null
  soakGreenAt: Date | null
  lastStalePingAt: Date | null
  lastSoakAlertAt: Date | null
  releasedAt: Date
}

function promoteAckCommand(version: string, env: "staging" | "production"): string {
  return `gh workflow run promote-openclaw-image.yml --ref staging -f version=${version} -f target_env=${env}`
}

export function bumpAlertCopy(args: {
  bump: RuntimeBumpClass
  version: string
  autoEligible: boolean
}): { title: string; detail: string } {
  const versionsUrl = `${resolvePublicAppUrl() || ""}/admin/versions`
  if (args.bump === "overlay-N" && args.autoEligible) {
    return {
      title: `Runtime overlay -N candidate ${args.version} ready`,
      detail: `Class overlay-N (same upstream tag). Auto-promote after 24h soak green. Admin: ${versionsUrl}`,
    }
  }
  if (args.bump === "overlay-N") {
    return {
      title: `Runtime overlay -N soak green ${args.version}`,
      detail: `Auto-promote overlay -N. Pin command: ${promoteAckCommand(args.version, "staging")}`,
    }
  }
  return {
    title: `Runtime ${args.bump} ${args.version} needs founder ACK`,
    detail: `Do not auto-promote date-tuple or upstream-revision. Founder ACK (migration-class): ${promoteAckCommand(args.version, "staging")} then production target_env after staging pin. Admin: ${versionsUrl}`,
  }
}

export async function notifyCandidateRegistered(row: {
  id: string
  version: string
  buildSourceTag: string | null
}): Promise<{ bump: RuntimeBumpClass; alerted: boolean }> {
  const stable = await prisma.openClawVersion.findFirst({
    where: { isStable: true },
    orderBy: { releasedAt: "desc" },
    select: { version: true, buildSourceTag: true },
  })
  const bump = classifyRuntimeBump(
    stable ?? { version: "0.0.0", buildSourceTag: null },
    row,
  )
  const copy = bumpAlertCopy({
    bump,
    version: row.version,
    autoEligible: mayAutoPromoteOverlayN(bump),
  })
  const sent = await sendOwnerAlert({
    alertKey: "runtime-candidate-ready",
    title: copy.title,
    detail: copy.detail,
  })
  await prisma.openClawVersion.update({
    where: { id: row.id },
    data: { lastSoakAlertAt: new Date() },
  })
  log.info("runtime-autoupdate: candidate registered", {
    version: row.version,
    bump,
    alertSent: sent.sent,
  })
  return { bump, alerted: sent.sent }
}

export async function markSoakGreen(version: string, now = new Date()): Promise<{
  bump: RuntimeBumpClass
  autoPromoted: boolean
  founderAckRequired: boolean
}> {
  const candidate = await prisma.openClawVersion.findUnique({ where: { version } })
  if (!candidate) {
    throw new Error(`OpenClawVersion ${version} not found`)
  }
  const stable = await prisma.openClawVersion.findFirst({
    where: { isStable: true },
    orderBy: { releasedAt: "desc" },
    select: { version: true, buildSourceTag: true },
  })
  const bump = classifyRuntimeBump(
    stable ?? { version: "0.0.0", buildSourceTag: null },
    candidate,
  )
  await prisma.openClawVersion.update({
    where: { id: candidate.id },
    data: { soakGreenAt: now },
  })

  const auto =
    mayAutoPromoteOverlayN(bump) && neverPromotableReason(candidate.version) === null
  if (auto) {
    await pinStableVersion(candidate.id, now)
    const copy = bumpAlertCopy({ bump, version: candidate.version, autoEligible: true })
    await sendOwnerAlert({
      alertKey: "runtime-candidate-ready",
      title: `Auto-promoted overlay -N ${candidate.version}`,
      detail: copy.detail,
    })
    return { bump, autoPromoted: true, founderAckRequired: false }
  }

  const copy = bumpAlertCopy({ bump, version: candidate.version, autoEligible: false })
  await sendOwnerAlert({
    alertKey: "runtime-candidate-ready",
    title: copy.title,
    detail: copy.detail,
  })
  return { bump, autoPromoted: false, founderAckRequired: true }
}

export async function pinStableVersion(id: string, now = new Date()): Promise<void> {
  await prisma.$transaction([
    prisma.openClawVersion.updateMany({
      where: { isStable: true },
      data: { isStable: false },
    }),
    prisma.openClawVersion.update({
      where: { id },
      data: { isStable: true, stableAt: now },
    }),
  ])
}

export function isStaleUnsoaked(
  row: Pick<CandidateRow, "isStable" | "supersededAt" | "soakGreenAt" | "releasedAt">,
  now: Date,
): boolean {
  if (row.isStable) return false
  if (row.supersededAt) return false
  if (row.soakGreenAt) return false
  return now.getTime() - row.releasedAt.getTime() >= STALE_CANDIDATE_MS
}

export function shouldStalePing(
  row: Pick<CandidateRow, "lastStalePingAt">,
  now: Date,
): boolean {
  if (!row.lastStalePingAt) return true
  return now.getTime() - row.lastStalePingAt.getTime() >= STALE_PING_COOLDOWN_MS
}

export async function pingStaleCandidates(now = new Date()): Promise<{
  pinged: string[]
  skipped: string[]
}> {
  const rows = await prisma.openClawVersion.findMany({
    where: { isStable: false, supersededAt: null, soakGreenAt: null },
    select: {
      id: true,
      version: true,
      releasedAt: true,
      lastStalePingAt: true,
      isStable: true,
      supersededAt: true,
      soakGreenAt: true,
    },
  })
  const pinged: string[] = []
  const skipped: string[] = []
  for (const row of rows) {
    if (!isStaleUnsoaked(row, now)) {
      skipped.push(row.version)
      continue
    }
    if (!shouldStalePing(row, now)) {
      skipped.push(row.version)
      continue
    }
    const copy = bumpAlertCopy({
      bump: "date-tuple",
      version: row.version,
      autoEligible: false,
    })
    await sendOwnerAlert({
      alertKey: "runtime-candidate-stale",
      title: `Stale runtime candidate ${row.version} (>14d unsoaked)`,
      detail: `Never silence. Soak or supersede. ${copy.detail}`,
    })
    await prisma.openClawVersion.update({
      where: { id: row.id },
      data: { lastStalePingAt: now },
    })
    pinged.push(row.version)
  }
  return { pinged, skipped }
}
