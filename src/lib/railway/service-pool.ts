/**
 * Railway service pool - banked empty services against the 25/day
 * serviceCreate cap.
 *
 * Why: serviceCreate is the ONLY Railway write with a hard daily account cap
 * (the governor's ledger). Services themselves are free while empty (no
 * active deployment, no volume) and the per-project inventory ceiling is 100
 * (Pro; support-raisable). So we bank creates continuously and make deploys
 * draw from inventory:
 *
 *   refill (cron)  : serviceCreate up to governor budget minus headroom
 *                    -> ServicePool row READY
 *   checkout       : deployToCloud create-branch claims a READY row FIRST;
 *                    serviceCreate only when the pool is empty
 *   recycle        : terminal teardown (Stop / delete / enforcement) wipes
 *                    env + destroys volumes + renames, then returns the
 *                    service READY - serviceDelete never burns inventory
 *
 * PRIVACY INVARIANT (locked by service-pool tests): a row flips
 * RECYCLING -> READY only after ALL of
 *   1. latest deployment removed,
 *   2. env vars replaced with the wipe marker (replace:true),
 *   3. attached volumes destroyed AND re-listed as zero,
 *   4. service renamed to pool-*,
 * are receipted. Any failure leaves the row RECYCLING (never claimable) for
 * the sweeper to retry. A prior tenant's volume surviving a recycle is a
 * privacy breach - the re-list gate makes that state unreachable.
 *
 * The pool is RAILWAY-only by design; the Fly adapter (provider per
 * workspace) does not use it - Fly Machines have no create cap.
 */

import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { sendOwnerAlert } from "@/lib/alerts/owner-alert"
import {
  countProjectServices,
  createEmptyPooledService,
  deleteService,
  deleteVolume,
  isRailwayConfigured,
  listServiceVolumeIds,
  removeLatestDeployment,
  renameService,
  updateServiceVariables,
} from "@/lib/openclaw/railway-client"
import {
  evaluateCreateBudget,
  recordQuotaHold,
  recordSuccessfulCreate,
} from "@/lib/railway/governor"
import { isRailwayCreateQuotaError } from "@/lib/railway/governor-budget"

// ---------------------------------------------------------------------------
// Constants + env knobs
// ---------------------------------------------------------------------------

/** RailwayCreateLedger.workspaceId sentinel for pool-banked creates. */
export const POOL_LEDGER_WORKSPACE_ID = "service-pool"

/** Pool services are named pool-<entropy>; claw services claw-<wsId>. */
export const POOL_SERVICE_PREFIX = "pool"

/**
 * Env wipe payload. variableCollectionUpsert with replace:true swaps the
 * ENTIRE collection for this map - every user var (keys, tokens, config
 * blobs) is gone after this call. The marker itself carries no tenant data
 * and doubles as a dashboard breadcrumb.
 */
export const POOL_WIPE_MARKER: Record<string, string> = { CLAWS_POOLED: "true" }

export const DEFAULT_POOL_TARGET = 60
export const DEFAULT_REFILL_HEADROOM = 3
export const DEFAULT_LOW_WATERMARK = 20
export const DEFAULT_PROJECT_SERVICE_CEILING = 100
export const DEFAULT_REFILL_BATCH = 5

/** RECYCLING rows younger than this are considered in-flight (not swept). */
export const RECYCLE_RETRY_MIN_AGE_MS = 10 * 60 * 1000
/** ASSIGNED rows older than this whose workspace moved on are stranded. */
export const STRANDED_ASSIGNED_AGE_MS = 60 * 60 * 1000
/** Low-watermark re-alert cadence. */
export const LOW_ALERT_COOLDOWN_MS = 12 * 60 * 60 * 1000

const POOL_META_ID = "default"

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback
}

export function isServicePoolEnabled(): boolean {
  return process.env.SERVICE_POOL_ENABLED !== "false"
}

export function parsePoolTarget(raw = process.env.SERVICE_POOL_TARGET): number {
  return parsePositiveInt(raw, DEFAULT_POOL_TARGET)
}

export function parseRefillHeadroom(raw = process.env.SERVICE_POOL_REFILL_HEADROOM): number {
  return parsePositiveInt(raw, DEFAULT_REFILL_HEADROOM)
}

export function parseLowWatermark(raw = process.env.SERVICE_POOL_LOW_WATERMARK): number {
  return parsePositiveInt(raw, DEFAULT_LOW_WATERMARK)
}

export function parseProjectServiceCeiling(
  raw = process.env.SERVICE_POOL_PROJECT_CEILING,
): number {
  return parsePositiveInt(raw, DEFAULT_PROJECT_SERVICE_CEILING)
}

export function parseRefillBatch(raw = process.env.SERVICE_POOL_REFILL_BATCH): number {
  return parsePositiveInt(raw, DEFAULT_REFILL_BATCH)
}

function poolServiceName(entropy: string): string {
  return `${POOL_SERVICE_PREFIX}-${entropy}`.substring(0, 32)
}

function errMessage(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 500)
}

function isMissingServiceError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err)
  return /not\s+found|404|does not exist|deleted/i.test(message)
}

// ---------------------------------------------------------------------------
// Pure refill math (unit-testable without DB/network)
// ---------------------------------------------------------------------------

export type RefillPlanInput = {
  readyCount: number
  target: number
  /** Governor snapshot: rolling 24h serviceCreate count. */
  rollingCount: number
  /** Governor snapshot: usable budget (cap - safety margin). */
  usable: number
  /** Refill keeps this many creates in reserve for live user deploys. */
  headroom: number
  quotaHoldUntil: Date | null
  now: Date
  projectServiceCount: number
  projectCeiling: number
  batch: number
}

/**
 * How many empty services to bank this tick. Zero when:
 *  - pool already at target
 *  - governor budget minus headroom is exhausted (live deploys keep priority)
 *  - Railway quota hold is active
 *  - the project service ceiling (Phase A: 100 on Pro) would be crossed
 * MUTATION: dropping the headroom subtraction lets refill starve live
 * deploys into the queue - the contract test fails.
 */
export function refillPlan(input: RefillPlanInput): number {
  if (input.quotaHoldUntil && input.now.getTime() < input.quotaHoldUntil.getTime()) {
    return 0
  }
  const poolWant = Math.max(0, input.target - input.readyCount)
  const budgetLeft = Math.max(0, input.usable - input.headroom - input.rollingCount)
  const ceilingLeft = Math.max(0, input.projectCeiling - input.projectServiceCount)
  return Math.max(0, Math.min(poolWant, budgetLeft, ceilingLeft, input.batch))
}

// ---------------------------------------------------------------------------
// Checkout (deployToCloud create-branch)
// ---------------------------------------------------------------------------

export type PoolCheckout = {
  entryId: string
  serviceId: string
  domain: string | null
}

const CHECKOUT_CLAIM_ATTEMPTS = 5

/**
 * Claim a READY pooled service for a workspace and rename it to the claw
 * service name. NEVER throws - any failure returns null and the caller falls
 * through to governed serviceCreate.
 *
 * Idempotent per workspace: a row already ASSIGNED to this workspace (from a
 * failed deploy attempt that never bound containerId) is reclaimed first so
 * retries cannot strand entries.
 */
export async function checkoutPooledService(
  workspaceId: string,
  clawServiceName: string,
): Promise<PoolCheckout | null> {
  if (!isServicePoolEnabled()) return null

  try {
    const mine = await prisma.servicePool.findFirst({
      where: { workspaceId, state: "ASSIGNED" },
    })
    if (mine) {
      try {
        await renameService(mine.serviceId, clawServiceName)
        log.info("service-pool: reclaimed prior ASSIGNED entry", {
          workspaceId,
          serviceId: mine.serviceId,
        })
        return { entryId: mine.id, serviceId: mine.serviceId, domain: mine.domain }
      } catch (err) {
        await prisma.servicePool.update({
          where: { id: mine.id },
          data: { state: "RECYCLING", workspaceId: null, lastError: errMessage(err) },
        })
        log.warn("service-pool: prior ASSIGNED entry unusable; released for sweep", {
          workspaceId,
          serviceId: mine.serviceId,
          error: errMessage(err),
        })
      }
    }

    for (let attempt = 0; attempt < CHECKOUT_CLAIM_ATTEMPTS; attempt++) {
      const candidate = await prisma.servicePool.findFirst({
        where: { state: "READY" },
        orderBy: { createdAt: "asc" },
      })
      if (!candidate) return null

      // Compare-and-swap claim: only one concurrent deploy wins this row.
      const claimed = await prisma.servicePool.updateMany({
        where: { id: candidate.id, state: "READY" },
        data: {
          state: "ASSIGNED",
          workspaceId,
          assignedAt: new Date(),
          lastError: null,
        },
      })
      if (claimed.count === 0) continue // raced - try the next row

      try {
        await renameService(candidate.serviceId, clawServiceName)
      } catch (err) {
        // Dead/unreachable service - release for sweep triage, try the next.
        await prisma.servicePool.update({
          where: { id: candidate.id },
          data: { state: "RECYCLING", workspaceId: null, lastError: errMessage(err) },
        })
        log.warn("service-pool: checkout rename failed; entry released for sweep", {
          workspaceId,
          serviceId: candidate.serviceId,
          error: errMessage(err),
        })
        continue
      }

      log.info("service-pool: checked out pooled service", {
        workspaceId,
        serviceId: candidate.serviceId,
        domain: candidate.domain,
      })
      return { entryId: candidate.id, serviceId: candidate.serviceId, domain: candidate.domain }
    }
    return null
  } catch (err) {
    log.error("service-pool: checkout failed; falling back to serviceCreate", {
      workspaceId,
      error: errMessage(err),
    })
    return null
  }
}

/**
 * Release a checked-out entry after the subsequent deploy failed against a
 * dead service (orphan-class error). The sweeper revalidates or discards it.
 */
export async function releasePoolEntryForSweep(
  entryId: string,
  reason: string,
): Promise<void> {
  try {
    await prisma.servicePool.update({
      where: { id: entryId },
      data: { state: "RECYCLING", workspaceId: null, lastError: reason.slice(0, 500) },
    })
  } catch (err) {
    log.error("service-pool: releasePoolEntryForSweep failed", {
      entryId,
      error: errMessage(err),
    })
  }
}

// ---------------------------------------------------------------------------
// Recycle (terminal teardown -> inventory)
// ---------------------------------------------------------------------------

export type RecycleOutcome =
  /** Fully receipted: env wiped, volumes destroyed (verified), renamed, READY. */
  | { outcome: "recycled" }
  /** Wipe started but a step failed - row stays RECYCLING for the sweeper. */
  | { outcome: "deferred"; reason: string }
  /** Service is gone on Railway - row deleted, nothing to recycle. */
  | { outcome: "missing" }
  /** Pool disabled - caller should serviceDelete (legacy path). */
  | { outcome: "disabled" }

/**
 * Wipe a service and return it to the pool. The pool row is upserted FIRST
 * (state RECYCLING) so the service is owned by the pool state machine before
 * any Railway call; a mid-wipe crash leaves it RECYCLING, never READY.
 */
export async function recycleServiceIntoPool(args: {
  serviceId: string
  workspaceId?: string | null
}): Promise<RecycleOutcome> {
  if (!isServicePoolEnabled()) return { outcome: "disabled" }

  const entry = await prisma.servicePool.upsert({
    where: { serviceId: args.serviceId },
    create: {
      serviceId: args.serviceId,
      state: "RECYCLING",
      workspaceId: args.workspaceId ?? null,
    },
    update: {
      state: "RECYCLING",
      workspaceId: args.workspaceId ?? null,
      recycledAt: null,
    },
  })

  const fail = async (step: string, err: unknown): Promise<RecycleOutcome> => {
    if (isMissingServiceError(err)) {
      await prisma.servicePool.delete({ where: { id: entry.id } }).catch(() => {})
      log.warn("service-pool: recycle target already gone; entry dropped", {
        serviceId: args.serviceId,
        step,
      })
      return { outcome: "missing" }
    }
    const reason = `${step}: ${errMessage(err)}`
    await prisma.servicePool
      .update({ where: { id: entry.id }, data: { lastError: reason.slice(0, 500) } })
      .catch(() => {})
    log.warn("service-pool: recycle deferred (stays RECYCLING)", {
      serviceId: args.serviceId,
      step,
      error: errMessage(err),
    })
    return { outcome: "deferred", reason }
  }

  // 1. Stop compute (idempotent when already REMOVED / NO_DEPLOYMENT).
  try {
    await removeLatestDeployment(args.serviceId)
  } catch (err) {
    return fail("deployment-remove", err)
  }

  // 2. Env wipe: replace the ENTIRE collection with the marker.
  try {
    await updateServiceVariables(args.serviceId, POOL_WIPE_MARKER)
  } catch (err) {
    return fail("env-wipe", err)
  }

  // 3. Volume destroy + verify-zero. PRIVACY GATE: a volume surviving this
  //    step means tenant data could be handed to the next checkout - the
  //    row must NEVER flip READY in that state.
  try {
    const volumes = await listServiceVolumeIds(args.serviceId)
    for (const volumeId of volumes) {
      await deleteVolume(volumeId)
    }
    if (volumes.length > 0) {
      const remaining = await listServiceVolumeIds(args.serviceId)
      if (remaining.length > 0) {
        return fail(
          "volume-verify",
          new Error(`${remaining.length} volume(s) still attached after destroy`),
        )
      }
    }
  } catch (err) {
    return fail("volume-destroy", err)
  }

  // 4. Rename to pool-* so adopt-by-name (claw-*) can never claim a banked
  //    service outside the pool state machine.
  try {
    await renameService(args.serviceId, poolServiceName(entry.id.slice(-10)))
  } catch (err) {
    return fail("rename", err)
  }

  // 5. Receipted - the row becomes claimable inventory. Domain is kept.
  await prisma.servicePool.update({
    where: { id: entry.id },
    data: {
      state: "READY",
      workspaceId: null,
      lastError: null,
      recycledAt: new Date(),
    },
  })
  log.info("service-pool: service recycled into pool", {
    serviceId: args.serviceId,
    fromWorkspaceId: args.workspaceId ?? null,
  })
  return { outcome: "recycled" }
}

export type TeardownServiceOutcome =
  | "recycled"
  | "recycling-deferred"
  | "missing"
  | "deleted"
  | "survived"

/**
 * Terminal-teardown entry point used by deployer.destroyContainer. Recycles
 * into the pool when enabled; falls back to legacy serviceDelete when the
 * pool is off. NEVER throws (destroyContainer's non-throwing contract).
 *
 * "survived" is the only outcome where the caller keeps containerHost (the
 * service may still be running under the workspace's name).
 */
export async function teardownServiceViaPool(args: {
  serviceId: string
  workspaceId: string
}): Promise<TeardownServiceOutcome> {
  try {
    const result = await recycleServiceIntoPool({
      serviceId: args.serviceId,
      workspaceId: args.workspaceId,
    })
    if (result.outcome === "recycled") return "recycled"
    if (result.outcome === "missing") return "missing"
    if (result.outcome === "deferred") return "recycling-deferred"
  } catch (err) {
    log.error("service-pool: teardown recycle threw; falling back to delete", {
      serviceId: args.serviceId,
      workspaceId: args.workspaceId,
      error: errMessage(err),
    })
  }

  // Pool disabled (or recycle path itself crashed): legacy delete semantics.
  try {
    await deleteService(args.serviceId)
    return "deleted"
  } catch (err) {
    if (isMissingServiceError(err)) return "missing"
    log.warn("service-pool: fallback deleteService failed - service may survive", {
      serviceId: args.serviceId,
      error: errMessage(err),
    })
    return "survived"
  }
}

// ---------------------------------------------------------------------------
// Refill tick (cron)
// ---------------------------------------------------------------------------

export type RefillTickResult = {
  enabled: boolean
  ready: number
  assigned: number
  recycling: number
  created: number
  sweptRecycling: number
  sweptStranded: number
  quotaHold: boolean
  ceilingBlocked: boolean
  lowAlerted: boolean
}

const SWEEP_BATCH = 3

async function poolCounts(): Promise<{ ready: number; assigned: number; recycling: number }> {
  const [ready, assigned, recycling] = await Promise.all([
    prisma.servicePool.count({ where: { state: "READY" } }),
    prisma.servicePool.count({ where: { state: "ASSIGNED" } }),
    prisma.servicePool.count({ where: { state: "RECYCLING" } }),
  ])
  return { ready, assigned, recycling }
}

/** Retry RECYCLING rows that are old enough to not be an in-flight teardown. */
async function sweepRecycling(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - RECYCLE_RETRY_MIN_AGE_MS)
  const rows = await prisma.servicePool.findMany({
    where: { state: "RECYCLING", updatedAt: { lt: cutoff } },
    orderBy: { updatedAt: "asc" },
    take: SWEEP_BATCH,
  })
  let done = 0
  for (const row of rows) {
    const result = await recycleServiceIntoPool({
      serviceId: row.serviceId,
      workspaceId: row.workspaceId,
    })
    if (result.outcome === "recycled" || result.outcome === "missing") done++
  }
  return done
}

/**
 * ASSIGNED rows whose workspace never bound (deploy failed before
 * containerId was written) or moved on / was deleted. After the age gate,
 * recycle them back to inventory.
 */
async function sweepStrandedAssigned(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - STRANDED_ASSIGNED_AGE_MS)
  const rows = await prisma.servicePool.findMany({
    where: { state: "ASSIGNED", assignedAt: { lt: cutoff } },
    orderBy: { assignedAt: "asc" },
    take: SWEEP_BATCH,
  })
  let swept = 0
  for (const row of rows) {
    const workspace = row.workspaceId
      ? await prisma.workspace.findUnique({
          where: { id: row.workspaceId },
          select: { containerId: true },
        })
      : null
    if (workspace?.containerId === row.serviceId) continue // legitimately bound
    const result = await recycleServiceIntoPool({
      serviceId: row.serviceId,
      workspaceId: row.workspaceId,
    })
    if (result.outcome !== "disabled") swept++
  }
  return swept
}

async function maybeSendLowWatermarkAlert(
  readyCount: number,
  now: Date,
): Promise<boolean> {
  const floor = parseLowWatermark()
  const meta = await prisma.servicePoolMeta.upsert({
    where: { id: POOL_META_ID },
    create: { id: POOL_META_ID, highWatermark: readyCount },
    update: {},
  })

  if (readyCount > meta.highWatermark) {
    await prisma.servicePoolMeta.update({
      where: { id: POOL_META_ID },
      data: { highWatermark: readyCount },
    })
  }

  // Expected-empty ramp: never alert before the pool has EVER reached the
  // floor. After that, alert on every 12h window while below it.
  const rampComplete = Math.max(meta.highWatermark, readyCount) >= floor
  const cooledDown =
    !meta.lowAlertSentAt ||
    now.getTime() - meta.lowAlertSentAt.getTime() >= LOW_ALERT_COOLDOWN_MS

  if (readyCount < floor && rampComplete && cooledDown) {
    try {
      await sendOwnerAlert({
        alertKey: "service-pool-low",
        title: "Service pool below floor",
        detail: `${readyCount} READY pooled services (< ${floor}). Refill is governor-capped; deploys fall back to serviceCreate when the pool empties.`,
      })
      await prisma.servicePoolMeta.update({
        where: { id: POOL_META_ID },
        data: { lowAlertSentAt: now },
      })
      return true
    } catch (err) {
      log.error("service-pool: low-watermark alert failed", { error: errMessage(err) })
    }
  }
  return false
}

/**
 * One cron tick: sweep RECYCLING retries, sweep stranded ASSIGNED, bank new
 * empty services up to (governor budget - headroom), then evaluate the
 * low-watermark alert. Each banked create is ledgered via
 * recordSuccessfulCreate (sentinel workspaceId) so the governor's rolling
 * window sees pool spend exactly like user spend.
 */
export async function refillServicePoolTick(now: Date = new Date()): Promise<RefillTickResult> {
  const base: RefillTickResult = {
    enabled: isServicePoolEnabled() && isRailwayConfigured(),
    ready: 0,
    assigned: 0,
    recycling: 0,
    created: 0,
    sweptRecycling: 0,
    sweptStranded: 0,
    quotaHold: false,
    ceilingBlocked: false,
    lowAlerted: false,
  }
  if (!base.enabled) return base

  base.sweptRecycling = await sweepRecycling(now)
  base.sweptStranded = await sweepStrandedAssigned(now)

  const counts = await poolCounts()
  base.assigned = counts.assigned
  base.recycling = counts.recycling

  const snapshot = await evaluateCreateBudget(now)
  base.quotaHold =
    !!snapshot.quotaHoldUntil && now.getTime() < snapshot.quotaHoldUntil.getTime()

  const target = parsePoolTarget()
  const ceiling = parseProjectServiceCeiling()

  let projectServiceCount = 0
  try {
    projectServiceCount = await countProjectServices()
  } catch (err) {
    // Cannot verify the inventory ceiling - do not create blind this tick.
    log.warn("service-pool: project service count failed; skipping refill tick", {
      error: errMessage(err),
    })
    base.ready = counts.ready
    base.lowAlerted = await maybeSendLowWatermarkAlert(counts.ready, now)
    return base
  }

  const plan = refillPlan({
    readyCount: counts.ready,
    target,
    rollingCount: snapshot.rollingCount,
    usable: snapshot.usable,
    headroom: parseRefillHeadroom(),
    quotaHoldUntil: snapshot.quotaHoldUntil,
    now,
    projectServiceCount,
    projectCeiling: ceiling,
    batch: parseRefillBatch(),
  })
  base.ceilingBlocked =
    plan === 0 && projectServiceCount >= ceiling && counts.ready < target

  for (let i = 0; i < plan; i++) {
    const entropy = `${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 8)}`
    try {
      const banked = await createEmptyPooledService(poolServiceName(entropy))
      await recordSuccessfulCreate(POOL_LEDGER_WORKSPACE_ID, banked.serviceId)
      await prisma.servicePool.create({
        data: {
          serviceId: banked.serviceId,
          domain: banked.domain,
          state: "READY",
        },
      })
      base.created++
    } catch (err) {
      if (isRailwayCreateQuotaError(err)) {
        const holdUntil = await recordQuotaHold(now)
        base.quotaHold = true
        log.warn("service-pool: Railway quota hit mid-refill; holding", {
          holdUntil: holdUntil.toISOString(),
          createdThisTick: base.created,
        })
      } else {
        log.error("service-pool: bank create failed", { error: errMessage(err) })
      }
      break
    }
  }

  base.ready = counts.ready + base.created
  base.lowAlerted = await maybeSendLowWatermarkAlert(base.ready, now)

  log.info("service-pool: refill tick", { ...base })
  return base
}

/** Counts for admin/report surfaces. */
export async function getServicePoolCounts(): Promise<{
  ready: number
  assigned: number
  recycling: number
}> {
  return poolCounts()
}
