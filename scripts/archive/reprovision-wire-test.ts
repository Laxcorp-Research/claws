/**
 * scripts/archive/reprovision-wire-test.ts
 *
 * WHAT
 *   One-off operational script that gives the staging WIRE-TEST workspace a real
 *   PLATFORM_CREDIT identity — SURGICALLY. WIRE-TEST's owner account also owns
 *   ~15 other staging workspaces, so we do NOT flip the user-level
 *   `User.apiKeySource`. Instead we set the workspace-level
 *   `Workspace.apiKeySourceOverride` on WIRE-TEST only (the field exists exactly
 *   for this isolation case).
 *
 *   Three idempotent writes, all inside ONE Serializable transaction:
 *     1. CreditAccount for the owner — $5 (500 cents), status ACTIVE.
 *     2. Workspace.apiKeySourceOverride = PLATFORM_CREDIT  (WIRE-TEST only).
 *     3. User.emailVerifiedForCredits = true               (consistency).
 *
 *   It does NOT redeploy. After this commits, the running container's env still
 *   reflects the OLD state (no credit mode) — that drift is the intended signal
 *   the PR-8a/C reconciliation cron will DETECT. To propagate the new state you
 *   must trigger a redeploy yourself:
 *     → Click "Redeploy" in the staging dashboard for the WIRE-TEST workspace.
 *       (That route runs deployToCloud server-side, where the Railway / master-key
 *       secrets live, and rebuilds env via deriveContainerEnv from the new DB row.)
 *
 * WHEN TO RUN
 *   Once, to turn staging WIRE-TEST into a meaningful subject for the
 *   env-reconciliation cron's observation window.
 *
 * USAGE
 *   Dry-run (DEFAULT — reads only, writes nothing):
 *     npx dotenv -e .env.staging -- npx tsx scripts/archive/reprovision-wire-test.ts
 *   Apply (writes — requires the explicit confirm flag):
 *     # bash:
 *     CONFIRM_REPROVISION=yes npx dotenv -e .env.staging -- npx tsx scripts/archive/reprovision-wire-test.ts
 *     # PowerShell:
 *     $env:CONFIRM_REPROVISION="yes"; npx dotenv -e .env.staging -- npx tsx scripts/archive/reprovision-wire-test.ts; Remove-Item Env:CONFIRM_REPROVISION
 *
 * ROLLBACK (SQL against the same DB, then click Redeploy again to revert the container):
 *   UPDATE "Workspace" SET "apiKeySourceOverride"=NULL WHERE id='cmpnvr35x0000vshq8vhoirc3';
 *   DELETE FROM "CreditAccount" WHERE "userId"='cmn1tjm6b000004kz51oynbtl';
 *   -- optional: UPDATE "User" SET "emailVerifiedForCredits"=false WHERE id='cmn1tjm6b000004kz51oynbtl';
 *
 * SAFETY
 *   - Defaults to DRY-RUN; real writes require CONFIRM_REPROVISION=yes.
 *   - Pre-flight ABORTS (throws, nothing written) if the workspace/user don't
 *     match the hard-coded WIRE-TEST identity, the workspace isn't RUNNING, or a
 *     CONFLICTING CreditAccount / override already exists. Conflicts are never
 *     silently overwritten — the operator must resolve them.
 *   - Idempotent: a second run on an already-provisioned state makes no writes.
 */
import { pathToFileURL } from "node:url"
import { PrismaClient } from "../../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

// Hard-coded WIRE-TEST identity (staging). Pre-flight cross-checks the live rows
// against these so the script can't be pointed at the wrong workspace/user.
export const EXPECTED_WORKSPACE_ID = "cmpnvr35x0000vshq8vhoirc3"
export const EXPECTED_USER_ID = "cmn1tjm6b000004kz51oynbtl"
export const TARGET_BALANCE_CENTS = 500

/** Subset of the Prisma client used here — satisfied by both PrismaClient and the interactive-tx client. */
type ReprovisionDb = Pick<PrismaClient, "workspace" | "user" | "creditAccount">

type CreditAction = "CREATE" | "SKIP_ALREADY_CORRECT"
type OverrideAction = "SET" | "NOOP_ALREADY_SET"
type EmailAction = "SET" | "NOOP_ALREADY_TRUE"

export interface ReprovisionOptions {
  confirm: boolean
  workspaceId: string
  userId: string
  balanceCents: number
  /** Injectable sink so tests stay quiet; defaults to console.log. */
  log?: (msg: string) => void
}

interface CurrentState {
  workspace: { id: string; name: string; status: string; userId: string; apiKeySourceOverride: string | null } | null
  user: { id: string; emailVerifiedForCredits: boolean } | null
  creditAccount: { id: string; balanceCents: number; initialGrantCents: number; status: string } | null
}

export interface ReprovisionPlan {
  creditAccount: CreditAction
  override: OverrideAction
  emailVerified: EmailAction
  changed: boolean
  current: {
    workspaceStatus: string
    workspaceOwner: string
    override: string | null
    emailVerified: boolean
    creditAccount: CurrentState["creditAccount"]
  }
}

export interface ReprovisionResult {
  mode: "dry-run" | "applied" | "noop"
  plan: ReprovisionPlan
  committed: boolean
}

/** Read every row the plan depends on. Reads only — safe to call outside a tx (dry-run) or inside one (apply). */
async function readState(db: ReprovisionDb, opts: ReprovisionOptions): Promise<CurrentState> {
  const workspace = await db.workspace.findUnique({
    where: { id: opts.workspaceId },
    select: { id: true, name: true, status: true, userId: true, apiKeySourceOverride: true },
  })
  const user = await db.user.findUnique({
    where: { id: opts.userId },
    select: { id: true, emailVerifiedForCredits: true },
  })
  const creditAccount = await db.creditAccount.findUnique({
    where: { userId: opts.userId },
    select: { id: true, balanceCents: true, initialGrantCents: true, status: true },
  })
  return { workspace, user, creditAccount }
}

/**
 * Pure decision function: validates pre-flight invariants and derives the per-step
 * plan from current state. THROWS (operation aborts, nothing written) on any
 * pre-flight violation or conflicting existing row. Same logic drives dry-run,
 * the apply path, and the in-transaction re-validation.
 */
export function computePlan(state: CurrentState, opts: ReprovisionOptions): ReprovisionPlan {
  if (!state.workspace) {
    throw new Error(`Pre-flight failed: workspace ${opts.workspaceId} not found — wrong DB or wrong ID. Aborting.`)
  }
  if (state.workspace.status !== "RUNNING") {
    throw new Error(
      `Pre-flight failed: workspace ${opts.workspaceId} status is ${state.workspace.status}, expected RUNNING. Aborting.`,
    )
  }
  if (state.workspace.userId !== opts.userId) {
    throw new Error(
      `Pre-flight failed: workspace ${opts.workspaceId} belongs to user ${state.workspace.userId}, ` +
        `expected ${opts.userId} — wrong IDs. Aborting.`,
    )
  }
  if (!state.user) {
    throw new Error(`Pre-flight failed: user ${opts.userId} not found. Aborting.`)
  }

  let creditAccount: CreditAction
  if (!state.creditAccount) {
    creditAccount = "CREATE"
  } else if (
    state.creditAccount.balanceCents === opts.balanceCents &&
    state.creditAccount.initialGrantCents === opts.balanceCents &&
    state.creditAccount.status === "ACTIVE"
  ) {
    creditAccount = "SKIP_ALREADY_CORRECT"
  } else {
    throw new Error(
      `Conflict: CreditAccount for user ${opts.userId} already exists with balanceCents=` +
        `${state.creditAccount.balanceCents}, initialGrantCents=${state.creditAccount.initialGrantCents}, ` +
        `status=${state.creditAccount.status} (expected ${opts.balanceCents}/${opts.balanceCents}/ACTIVE). ` +
        `Refusing to overwrite — operator must resolve manually.`,
    )
  }

  let override: OverrideAction
  if (state.workspace.apiKeySourceOverride === null) {
    override = "SET"
  } else if (state.workspace.apiKeySourceOverride === "PLATFORM_CREDIT") {
    override = "NOOP_ALREADY_SET"
  } else {
    throw new Error(
      `Conflict: workspace ${opts.workspaceId} apiKeySourceOverride is ${state.workspace.apiKeySourceOverride}, ` +
        `expected null or PLATFORM_CREDIT. Refusing to overwrite — operator must resolve manually.`,
    )
  }

  const emailVerified: EmailAction = state.user.emailVerifiedForCredits ? "NOOP_ALREADY_TRUE" : "SET"

  const changed = creditAccount === "CREATE" || override === "SET" || emailVerified === "SET"

  return {
    creditAccount,
    override,
    emailVerified,
    changed,
    current: {
      workspaceStatus: state.workspace.status,
      workspaceOwner: state.workspace.userId,
      override: state.workspace.apiKeySourceOverride,
      emailVerified: state.user.emailVerifiedForCredits,
      creditAccount: state.creditAccount,
    },
  }
}

/** Execute exactly the writes the plan calls for. Must run inside the Serializable tx. */
async function applyWrites(db: ReprovisionDb, plan: ReprovisionPlan, opts: ReprovisionOptions): Promise<void> {
  if (plan.creditAccount === "CREATE") {
    await db.creditAccount.create({
      data: {
        userId: opts.userId,
        balanceCents: opts.balanceCents,
        initialGrantCents: opts.balanceCents,
        status: "ACTIVE",
        // Manual operator grant: no email/IP fingerprint (the @unique userId
        // already prevents duplicates); flaggedForReview stays default false.
      },
    })
  }
  if (plan.override === "SET") {
    await db.workspace.update({
      where: { id: opts.workspaceId },
      data: { apiKeySourceOverride: "PLATFORM_CREDIT" },
    })
  }
  if (plan.emailVerified === "SET") {
    await db.user.update({
      where: { id: opts.userId },
      data: { emailVerifiedForCredits: true },
    })
  }
}

function countChanges(plan: ReprovisionPlan): number {
  let n = 0
  if (plan.creditAccount === "CREATE") n++
  if (plan.override === "SET") n++
  if (plan.emailVerified === "SET") n++
  return n
}

/** Human-readable per-step lines. `applied` toggles WOULD-x vs past-tense verbs. */
function stepLines(plan: ReprovisionPlan, opts: ReprovisionOptions, applied: boolean): string[] {
  const lines: string[] = []

  if (plan.creditAccount === "CREATE") {
    lines.push(
      `[creditAccount] ${applied ? "CREATED" : "WOULD CREATE"}: none → ` +
        `balanceCents=${opts.balanceCents} initialGrantCents=${opts.balanceCents} status=ACTIVE`,
    )
  } else {
    const ca = plan.current.creditAccount
    lines.push(
      `[creditAccount] SKIPPED: already correct ` +
        `(balanceCents=${ca?.balanceCents} initialGrantCents=${ca?.initialGrantCents} status=${ca?.status})`,
    )
  }

  if (plan.override === "SET") {
    lines.push(
      `[override] ${applied ? "UPDATED" : "WOULD SET"}: ` +
        `apiKeySourceOverride ${plan.current.override === null ? "null" : plan.current.override} → PLATFORM_CREDIT`,
    )
  } else {
    lines.push(`[override] NO-OP: apiKeySourceOverride already PLATFORM_CREDIT`)
  }

  if (plan.emailVerified === "SET") {
    lines.push(
      `[emailVerified] ${applied ? "UPDATED" : "WOULD SET"}: emailVerifiedForCredits ${plan.current.emailVerified} → true`,
    )
  } else {
    lines.push(`[emailVerified] NO-OP: emailVerifiedForCredits already true`)
  }

  return lines
}

/**
 * Orchestrates the reprovision. Pure-ish: takes the Prisma client so tests can
 * pass a mock. Returns the resolved plan. Throws on pre-flight/conflict (before
 * any write). DRY-RUN unless opts.confirm is true.
 */
export async function reprovisionWireTest(prisma: PrismaClient, opts: ReprovisionOptions): Promise<ReprovisionResult> {
  const log = opts.log ?? ((m: string) => console.log(m))

  log(
    `[reprovision-wire-test] MODE: ${
      opts.confirm ? "APPLY (CONFIRM_REPROVISION=yes)" : "DRY-RUN (no CONFIRM_REPROVISION — writes nothing)"
    }`,
  )
  log(`[reprovision-wire-test] target workspace=${opts.workspaceId} user=${opts.userId} grant=${opts.balanceCents}c`)

  // Read + validate (throws on pre-flight violation or conflict — before any write).
  const state = await readState(prisma, opts)
  const plan = computePlan(state, opts)

  log(`[pre-flight] workspace ${opts.workspaceId} status=${plan.current.workspaceStatus} owner=${plan.current.workspaceOwner} — OK`)
  log(`[pre-flight] user ${opts.userId} exists — OK`)

  // DRY-RUN: report intended changes, write nothing.
  if (!opts.confirm) {
    for (const line of stepLines(plan, opts, false)) log(line)
    log(
      plan.changed
        ? `[summary] DRY-RUN — ${countChanges(plan)} change(s) pending. No writes performed.`
        : `[summary] DRY-RUN — already provisioned, 0 changes pending.`,
    )
    log(
      `[next] Re-run with CONFIRM_REPROVISION=yes to apply, then click Redeploy in the staging dashboard ` +
        `for WIRE-TEST workspace ${opts.workspaceId}.`,
    )
    return { mode: "dry-run", plan, committed: false }
  }

  // Nothing to change: no-op exit, no transaction opened.
  if (!plan.changed) {
    for (const line of stepLines(plan, opts, true)) log(line)
    log(`[summary] Already provisioned — no changes needed.`)
    log(
      `[next] Nothing to apply. If the container still shows the old (non-credit) env, click Redeploy ` +
        `in the staging dashboard for WIRE-TEST workspace ${opts.workspaceId}.`,
    )
    return { mode: "noop", plan, committed: false }
  }

  // Apply all writes atomically. Re-read + re-validate inside the tx so a
  // concurrent change can't slip past the Serializable boundary; any conflict
  // there rolls the whole transaction back (no partial provision).
  const appliedPlan = await prisma.$transaction(
    async (tx) => {
      const txState = await readState(tx, opts)
      const txPlan = computePlan(txState, opts)
      await applyWrites(tx, txPlan, opts)
      return txPlan
    },
    { isolationLevel: "Serializable" },
  )

  for (const line of stepLines(appliedPlan, opts, true)) log(line)
  log(`[summary] APPLIED — ${countChanges(appliedPlan)} change(s) committed in a Serializable transaction.`)
  log(
    `[next] Now click Redeploy in the staging dashboard for WIRE-TEST workspace ${opts.workspaceId} ` +
      `to propagate PLATFORM_CREDIT to the running container.`,
  )
  return { mode: "applied", plan: appliedPlan, committed: true }
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error(
      "[reprovision-wire-test] DATABASE_URL not set. Run via: " +
        "npx dotenv -e .env.staging -- npx tsx scripts/archive/reprovision-wire-test.ts",
    )
    process.exitCode = 1
    return
  }

  const confirm = process.env.CONFIRM_REPROVISION === "yes"
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  try {
    await reprovisionWireTest(prisma, {
      confirm,
      workspaceId: EXPECTED_WORKSPACE_ID,
      userId: EXPECTED_USER_ID,
      balanceCents: TARGET_BALANCE_CENTS,
    })
  } catch (err) {
    console.error(`[reprovision-wire-test] ABORTED: ${err instanceof Error ? err.message : String(err)}`)
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

// Auto-run only when invoked directly as a script — never when imported by the
// test runner (vitest imports reprovisionWireTest/computePlan to exercise them).
function isDirectRun(): boolean {
  if (process.env.VITEST) return false
  if (!process.argv[1]) return false
  try {
    return import.meta.url === pathToFileURL(process.argv[1]).href
  } catch {
    return false
  }
}

if (isDirectRun()) {
  void main()
}
