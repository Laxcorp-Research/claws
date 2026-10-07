/**
 * Railway deploy governor - budget gate, quota backstop, FIFO drain helpers.
 *
 * Does not import deployer (drain dynamically imports deployToCloud).
 */

import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { assertHostedModule } from "@/lib/profile"
import { sendOwnerAlert } from "@/lib/alerts/owner-alert"
import { ledgerHealAttempt } from "@/lib/healing/ledger"
import { checkDeployEligibility } from "@/lib/dodo-payments"
import {
  computeQueueEta,
  isCreateBudgetAllowed,
  parseCreateDailyCap,
  parseSafetyMargin,
  queuedUserMessage,
  quotaHoldUntilFromRejection,
  shouldAlertCreateBudget80,
  usableCreateBudget,
  type CreateBudgetSnapshot,
  type QueueReason,
  CREATE_WINDOW_MS,
} from "@/lib/railway/governor-budget"

export class ProvisioningQueuedError extends Error {
  readonly name = "ProvisioningQueuedError"
  constructor(readonly queued: QueuedProvision) {
    super("PROVISIONING_QUEUED")
  }
}

export function isProvisioningQueuedError(err: unknown): err is ProvisioningQueuedError {
  return err instanceof ProvisioningQueuedError ||
    (err instanceof Error && err.name === "ProvisioningQueuedError")
}

export type QueuedProvision = {
  workspaceId: string
  position: number
  etaAt: Date
  reason: QueueReason
  message: string
}

const GOVERNOR_STATE_ID = "default"

function asCount(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) ? n : 0
}

async function loadRollingCreatedAts(now: Date): Promise<Date[]> {
  const windowStart = new Date(now.getTime() - CREATE_WINDOW_MS)
  const rows = await prisma.railwayCreateLedger.findMany({
    where: { createdAt: { gt: windowStart } },
    orderBy: { createdAt: "asc" },
    select: { createdAt: true },
  })
  return Array.isArray(rows) ? rows.map((r) => r.createdAt) : []
}

async function loadQuotaHoldUntil(): Promise<Date | null> {
  const row = await prisma.railwayGovernorState.findUnique({
    where: { id: GOVERNOR_STATE_ID },
    select: { quotaHoldUntil: true },
  })
  return row?.quotaHoldUntil ?? null
}

export async function evaluateCreateBudget(now: Date = new Date()): Promise<CreateBudgetSnapshot> {
  assertHostedModule("railway-governor")
  const cap = parseCreateDailyCap()
  const margin = parseSafetyMargin()
  const usable = usableCreateBudget(cap, margin)
  const windowStart = new Date(now.getTime() - CREATE_WINDOW_MS)
  const rollingCount = asCount(
    await prisma.railwayCreateLedger.count({
      where: { createdAt: { gt: windowStart } },
    }),
  )
  const quotaHoldUntil = await loadQuotaHoldUntil()
  const createdAts = await loadRollingCreatedAts(now)
  const allowed = isCreateBudgetAllowed({ rollingCount, usable, quotaHoldUntil, now })
  const etaAt = computeQueueEta({
    createdAtsOldestFirst: createdAts,
    usable,
    now,
    quotaHoldUntil,
  })
  return { cap, margin, usable, rollingCount, quotaHoldUntil, allowed, etaAt }
}

async function queuePosition(enqueuedAt: Date): Promise<number> {
  return prisma.provisioningQueue.count({
    where: { enqueuedAt: { lte: enqueuedAt } },
  })
}

async function maybeAlertBudget80(workspaceId: string, rollingCount: number, cap: number): Promise<void> {
  if (!shouldAlertCreateBudget80(rollingCount, cap)) return
  try {
    await sendOwnerAlert({
      alertKey: "railway-create-budget",
      title: "Railway create budget at 80%",
      detail: `Railway serviceCreate budget at ${rollingCount}/${cap} (80% threshold).`,
      workspaceId,
    })
  } catch (err) {
    log.error("governor: 80% budget alert failed", {
      workspaceId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

export async function enqueueProvisioning(
  workspaceId: string,
  reason: QueueReason,
  now: Date = new Date(),
): Promise<QueuedProvision> {
  const snapshot = await evaluateCreateBudget(now)
  const etaAt = snapshot.etaAt
  const existing = await prisma.provisioningQueue.findUnique({
    where: { workspaceId },
    select: { enqueuedAt: true },
  })
  const isFirst = !existing

  const row = await prisma.provisioningQueue.upsert({
    where: { workspaceId },
    create: { workspaceId, reason, etaAt },
    update: { reason, etaAt },
  })

  await prisma.workspace.update({
    where: { id: workspaceId },
    data: { status: "PROVISIONING_QUEUED" },
  })

  const position = await queuePosition(row.enqueuedAt)
  const queued: QueuedProvision = {
    workspaceId,
    position,
    etaAt,
    reason,
    message: queuedUserMessage(etaAt, now),
  }

  log.info("governor: workspace queued for provision", {
    workspaceId,
    reason,
    position,
    etaAt: etaAt.toISOString(),
  })

  if (isFirst) {
    log.info("governor: first-queue (customer alert off)", {
      workspaceId,
      position,
    })
  }

  return queued
}

export async function assertCreateBudgetOrEnqueue(workspaceId: string): Promise<void> {
  const snapshot = await evaluateCreateBudget()
  if (snapshot.allowed) return
  const queued = await enqueueProvisioning(workspaceId, "budget")
  throw new ProvisioningQueuedError(queued)
}

export async function recordSuccessfulCreate(workspaceId: string, serviceId: string): Promise<void> {
  await prisma.railwayCreateLedger.create({
    data: { workspaceId, serviceId },
  })
  await prisma.railwayGovernorState.upsert({
    where: { id: GOVERNOR_STATE_ID },
    create: { id: GOVERNOR_STATE_ID, quotaHoldUntil: null },
    update: { quotaHoldUntil: null },
  })
  await prisma.provisioningQueue.deleteMany({ where: { workspaceId } })

  const snapshot = await evaluateCreateBudget()
  await maybeAlertBudget80(workspaceId, snapshot.rollingCount, snapshot.cap)
}

/**
 * Mark the account-wide Railway quota hold after a serviceCreate rejection.
 * Shared by the user-deploy path (enqueueFromQuotaRejection) and the service
 * pool refill (which never enqueues a workspace). Returns the hold deadline.
 */
export async function recordQuotaHold(now: Date = new Date()): Promise<Date> {
  const cap = parseCreateDailyCap()
  const margin = parseSafetyMargin()
  const usable = usableCreateBudget(cap, margin)
  const createdAts = await loadRollingCreatedAts(now)
  const holdUntil = quotaHoldUntilFromRejection({ createdAtsOldestFirst: createdAts, usable, now })

  await prisma.railwayGovernorState.upsert({
    where: { id: GOVERNOR_STATE_ID },
    create: { id: GOVERNOR_STATE_ID, quotaHoldUntil: holdUntil },
    update: { quotaHoldUntil: holdUntil },
  })

  return holdUntil
}

export async function enqueueFromQuotaRejection(workspaceId: string): Promise<QueuedProvision> {
  const now = new Date()
  const holdUntil = await recordQuotaHold(now)

  log.warn("governor: Railway create quota - marking hold + enqueue", {
    workspaceId,
    quotaHoldUntil: holdUntil.toISOString(),
  })

  return enqueueProvisioning(workspaceId, "railway_quota", now)
}

export async function dequeueProvisioning(workspaceId: string): Promise<void> {
  await prisma.provisioningQueue.deleteMany({ where: { workspaceId } })
}

export type DrainTickResult = {
  started: number
  skippedIneligible: number
  skippedNoBudget: number
  empty: boolean
}

/**
 * FIFO head only. Re-checks entitlement then schedules deploy via `after`.
 * HTTP path returns immediately; deploy runs after the response.
 */
export async function drainProvisioningQueueHead(schedule: (fn: () => void | Promise<void>) => void): Promise<DrainTickResult> {
  const snapshot = await evaluateCreateBudget()
  if (!snapshot.allowed) {
    return { started: 0, skippedIneligible: 0, skippedNoBudget: 1, empty: false }
  }

  const head = await prisma.provisioningQueue.findFirst({
    orderBy: { enqueuedAt: "asc" },
    include: {
      workspace: {
        select: {
          id: true,
          status: true,
          user: {
            select: {
              trialUsed: true,
              trialStartedAt: true,
              trialEndsAt: true,
              hasActiveSubscription: true,
              subscriptionStatus: true,
              subscriptionOnHoldAt: true,
            },
          },
        },
      },
    },
  })

  if (!head) {
    return { started: 0, skippedIneligible: 0, skippedNoBudget: 0, empty: true }
  }

  const eligibility = checkDeployEligibility(head.workspace.user)
  if (!eligibility.canDeploy) {
    await prisma.provisioningQueue.delete({ where: { id: head.id } })
    if (head.workspace.status === "PROVISIONING_QUEUED") {
      await prisma.workspace.update({
        where: { id: head.workspaceId },
        data: { status: "STOPPED" },
      })
    }
    log.info("governor: dequeued ineligible workspace (no resurrection)", {
      workspaceId: head.workspaceId,
      reason: eligibility.reason,
    })
    return { started: 0, skippedIneligible: 1, skippedNoBudget: 0, empty: false }
  }

  await prisma.provisioningQueue.update({
    where: { id: head.id },
    data: { attempts: { increment: 1 }, lastAttemptAt: new Date(), lastError: null },
  })

  const workspaceId = head.workspaceId
  schedule(async () => {
    try {
      const { deployToCloud } = await import("@/lib/openclaw/deployer")
      await deployToCloud(workspaceId)
      await ledgerHealAttempt({
        workspaceId,
        condition: "provisioning-queued",
        outcome: "healed",
        detail: "drainProvisioningQueueHead started deploy",
      })
    } catch (err) {
      if (isProvisioningQueuedError(err)) {
        log.info("governor: drain re-queued (budget closed mid-flight)", { workspaceId })
        await ledgerHealAttempt({
          workspaceId,
          condition: "provisioning-queued",
          outcome: "skipped",
          detail: "budget closed mid-flight",
        })
        return
      }
      const message = err instanceof Error ? err.message : String(err)
      log.error("governor: drain deploy failed", { workspaceId, error: message })
      await ledgerHealAttempt({
        workspaceId,
        condition: "provisioning-queued",
        outcome: "failed",
        detail: message.slice(0, 500),
      })
      await prisma.provisioningQueue.updateMany({
        where: { workspaceId },
        data: { lastError: message.slice(0, 500) },
      })
    }
  })

  return { started: 1, skippedIneligible: 0, skippedNoBudget: 0, empty: false }
}
