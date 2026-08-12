// Tests for scripts/archive/reprovision-wire-test.ts — the surgical WIRE-TEST
// reprovision script. Exercises reprovisionWireTest against a mocked Prisma
// client (no DB). Covers: dry-run (no writes), apply (3 ops in a Serializable
// tx), idempotency (no writes), pre-flight aborts, and conflict aborts.
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest"
import { prismaMock } from "@/test/helpers/mock-prisma"
import {
  reprovisionWireTest,
  EXPECTED_WORKSPACE_ID,
  EXPECTED_USER_ID,
  TARGET_BALANCE_CENTS,
} from "../reprovision-wire-test"

const opts = (confirm: boolean) => ({
  confirm,
  workspaceId: EXPECTED_WORKSPACE_ID,
  userId: EXPECTED_USER_ID,
  balanceCents: TARGET_BALANCE_CENTS,
  log: () => {},
})

const fn = (m: unknown) => m as unknown as Mock

/** Make $transaction(cb, opts) invoke the callback with prismaMock as the tx. */
function wireTransaction() {
  fn(prismaMock.$transaction).mockImplementation(
    async (cb: (tx: typeof prismaMock) => Promise<unknown>) => cb(prismaMock),
  )
}

type StateOverrides = {
  workspace?: Record<string, unknown> | null
  user?: Record<string, unknown> | null
  creditAccount?: Record<string, unknown> | null
}

const WS_CLEAN = {
  id: EXPECTED_WORKSPACE_ID,
  name: "WIRE-TEST-2026-05-27-1346",
  status: "RUNNING",
  userId: EXPECTED_USER_ID,
  apiKeySourceOverride: null,
}
const USER_CLEAN = { id: EXPECTED_USER_ID, emailVerifiedForCredits: false }

/** Default: clean (unprovisioned) WIRE-TEST. Overrides replace individual rows. */
function setState(o: StateOverrides = {}) {
  fn(prismaMock.workspace.findUnique).mockResolvedValue(
    o.workspace === undefined ? WS_CLEAN : o.workspace,
  )
  fn(prismaMock.user.findUnique).mockResolvedValue(o.user === undefined ? USER_CLEAN : o.user)
  fn(prismaMock.creditAccount.findUnique).mockResolvedValue(
    o.creditAccount === undefined ? null : o.creditAccount,
  )
}

beforeEach(() => {
  // prismaMock is auto-reset by the mock-prisma helper's beforeEach.
  vi.clearAllMocks()
})

describe("reprovisionWireTest", () => {
  it("dry-run (default) computes the full plan but performs NO writes and opens NO transaction", async () => {
    setState()
    const res = await reprovisionWireTest(prismaMock, opts(false))

    expect(res.mode).toBe("dry-run")
    expect(res.committed).toBe(false)
    expect(res.plan.changed).toBe(true)
    expect(res.plan.creditAccount).toBe("CREATE")
    expect(res.plan.override).toBe("SET")
    expect(res.plan.emailVerified).toBe("SET")

    expect(prismaMock.$transaction).not.toHaveBeenCalled()
    expect(prismaMock.creditAccount.create).not.toHaveBeenCalled()
    expect(prismaMock.workspace.update).not.toHaveBeenCalled()
    expect(prismaMock.user.update).not.toHaveBeenCalled()
  })

  it("CONFIRM + clean state → all 3 ops execute inside a Serializable transaction", async () => {
    setState()
    wireTransaction()

    const res = await reprovisionWireTest(prismaMock, opts(true))

    expect(res.mode).toBe("applied")
    expect(res.committed).toBe(true)

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    const txCall = fn(prismaMock.$transaction).mock.calls[0]
    expect(txCall[1]).toEqual({ isolationLevel: "Serializable" })

    expect(prismaMock.creditAccount.create).toHaveBeenCalledWith({
      data: {
        userId: EXPECTED_USER_ID,
        balanceCents: 500,
        initialGrantCents: 500,
        status: "ACTIVE",
      },
    })
    expect(prismaMock.workspace.update).toHaveBeenCalledWith({
      where: { id: EXPECTED_WORKSPACE_ID },
      data: { apiKeySourceOverride: "PLATFORM_CREDIT" },
    })
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: EXPECTED_USER_ID },
      data: { emailVerifiedForCredits: true },
    })
  })

  it("idempotent: already-provisioned state → mode=noop, NO transaction, NO writes", async () => {
    setState({
      workspace: { ...WS_CLEAN, apiKeySourceOverride: "PLATFORM_CREDIT" },
      user: { id: EXPECTED_USER_ID, emailVerifiedForCredits: true },
      creditAccount: { id: "ca-1", balanceCents: 500, initialGrantCents: 500, status: "ACTIVE" },
    })
    wireTransaction()

    const res = await reprovisionWireTest(prismaMock, opts(true))

    expect(res.mode).toBe("noop")
    expect(res.committed).toBe(false)
    expect(res.plan.changed).toBe(false)
    expect(res.plan.creditAccount).toBe("SKIP_ALREADY_CORRECT")
    expect(res.plan.override).toBe("NOOP_ALREADY_SET")
    expect(res.plan.emailVerified).toBe("NOOP_ALREADY_TRUE")

    expect(prismaMock.$transaction).not.toHaveBeenCalled()
    expect(prismaMock.creditAccount.create).not.toHaveBeenCalled()
    expect(prismaMock.workspace.update).not.toHaveBeenCalled()
    expect(prismaMock.user.update).not.toHaveBeenCalled()
  })

  it("partial idempotency: credit already correct, override missing → only the override + email writes run", async () => {
    setState({
      workspace: { ...WS_CLEAN, apiKeySourceOverride: null },
      user: { id: EXPECTED_USER_ID, emailVerifiedForCredits: true },
      creditAccount: { id: "ca-1", balanceCents: 500, initialGrantCents: 500, status: "ACTIVE" },
    })
    wireTransaction()

    const res = await reprovisionWireTest(prismaMock, opts(true))

    expect(res.mode).toBe("applied")
    expect(res.plan.creditAccount).toBe("SKIP_ALREADY_CORRECT")
    expect(res.plan.override).toBe("SET")
    expect(res.plan.emailVerified).toBe("NOOP_ALREADY_TRUE")

    expect(prismaMock.creditAccount.create).not.toHaveBeenCalled()
    expect(prismaMock.workspace.update).toHaveBeenCalledTimes(1)
    expect(prismaMock.user.update).not.toHaveBeenCalled()
  })

  it("pre-flight: workspace not found → throws, no writes", async () => {
    setState({ workspace: null })
    wireTransaction()

    await expect(reprovisionWireTest(prismaMock, opts(true))).rejects.toThrow(
      /workspace .* not found/,
    )
    expect(prismaMock.creditAccount.create).not.toHaveBeenCalled()
    expect(prismaMock.workspace.update).not.toHaveBeenCalled()
  })

  it("pre-flight: workspace not RUNNING → throws", async () => {
    setState({ workspace: { ...WS_CLEAN, status: "STOPPED" } })
    await expect(reprovisionWireTest(prismaMock, opts(true))).rejects.toThrow(
      /status is STOPPED, expected RUNNING/,
    )
  })

  it("pre-flight: workspace owned by a different user → throws (defensive ID guard)", async () => {
    setState({ workspace: { ...WS_CLEAN, userId: "cmOTHERuser000000000000000" } })
    await expect(reprovisionWireTest(prismaMock, opts(true))).rejects.toThrow(
      /belongs to user cmOTHERuser/,
    )
  })

  it("pre-flight: user not found → throws", async () => {
    setState({ user: null })
    await expect(reprovisionWireTest(prismaMock, opts(true))).rejects.toThrow(/user .* not found/)
  })

  it("conflict: existing CreditAccount with DIFFERENT amounts → throws, never overwrites", async () => {
    setState({
      creditAccount: { id: "ca-1", balanceCents: 2500, initialGrantCents: 2500, status: "ACTIVE" },
    })
    wireTransaction()

    await expect(reprovisionWireTest(prismaMock, opts(true))).rejects.toThrow(
      /Conflict: CreditAccount .* Refusing to overwrite/,
    )
    expect(prismaMock.creditAccount.create).not.toHaveBeenCalled()
    expect(prismaMock.workspace.update).not.toHaveBeenCalled()
  })

  it("conflict: existing CreditAccount with non-ACTIVE status → throws", async () => {
    setState({
      creditAccount: { id: "ca-1", balanceCents: 500, initialGrantCents: 500, status: "EXHAUSTED" },
    })
    await expect(reprovisionWireTest(prismaMock, opts(true))).rejects.toThrow(
      /Conflict: CreditAccount .* status=EXHAUSTED/,
    )
  })

  it("conflict: apiKeySourceOverride already set to a DIFFERENT value → throws", async () => {
    setState({ workspace: { ...WS_CLEAN, apiKeySourceOverride: "USER_OWN_KEY" } })
    await expect(reprovisionWireTest(prismaMock, opts(true))).rejects.toThrow(
      /apiKeySourceOverride is USER_OWN_KEY/,
    )
  })

  it("conflict aborts even in dry-run (computePlan validates before any mode branch)", async () => {
    setState({
      creditAccount: { id: "ca-1", balanceCents: 999, initialGrantCents: 999, status: "ACTIVE" },
    })
    await expect(reprovisionWireTest(prismaMock, opts(false))).rejects.toThrow(/Refusing to overwrite/)
  })
})
