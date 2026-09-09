import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { PHASE_A_CONDITION_IDS } from "@/lib/healing/conditions"
import {
  HEAL_REGISTRY,
  getHealPolicy,
  listedConditionIds,
  ownerOnlyConditionIds,
} from "@/lib/healing/registry"

const RULINGS = new Set(["platform", "user-only", "owner-only", "deferred-b2", "deferred-b3"])

describe("HEAL_REGISTRY coverage", () => {
  it("MUTATION: every Phase-A condition is mapped (drop a key → fail)", () => {
    expect(Object.keys(HEAL_REGISTRY).sort()).toEqual([...PHASE_A_CONDITION_IDS].sort())
    expect(listedConditionIds().sort()).toEqual([...PHASE_A_CONDITION_IDS].sort())
  })

  it("every row has a locked ruling", () => {
    for (const id of PHASE_A_CONDITION_IDS) {
      const row = getHealPolicy(id)
      expect(RULINGS.has(row.ruling)).toBe(true)
      expect(row.id).toBe(id)
    }
  })

  it("owner-only plane includes create-budget and credit infra", () => {
    expect(ownerOnlyConditionIds()).toEqual(
      expect.arrayContaining(["railway-create-budget", "credit-pool", "credit-balance-drift"]),
    )
    expect(getHealPolicy("railway-create-budget").plane).toBe("owner")
    expect(getHealPolicy("provisioning-queued").plane).toBe("none")
  })

  it("state-sync-stale retries trySyncNow three times then customer-alert", () => {
    const row = getHealPolicy("state-sync-stale")
    expect(row.existingHeal).toBe("trySyncNow")
    expect(row.retries).toBe(3)
    expect(row.escalate).toBe("customer-alert")
  })

  it("keyless-boot is the deploy provider-auth gate, not a customer page", () => {
    const row = getHealPolicy("keyless-boot")
    expect(row.existingHeal).toBe("evaluateWorkspaceDeployProviderAuth")
    expect(row.plane).toBe("none")
  })

  it("railway-domain-cap is platform prune+retry with owner-alert on failure", () => {
    const row = getHealPolicy("railway-domain-cap")
    expect(row.ruling).toBe("platform")
    expect(row.plane).toBe("owner")
    expect(row.existingHeal).toBe("prune+retry")
    expect(row.retries).toBe(1)
    expect(row.escalate).toBe("owner-alert")
  })

  it("silent-wake retries wake with backoff then owner-alert (never silent)", () => {
    const row = getHealPolicy("silent-wake")
    expect(row.ruling).toBe("platform")
    expect(row.plane).toBe("owner")
    expect(row.existingHeal).toContain("retryWakeWithBackoff")
    expect(row.retries).toBe(3)
    expect(row.escalate).toBe("owner-alert")
  })

  it("heartbeat-missed-wake escalates owner, not customer-only", () => {
    const row = getHealPolicy("heartbeat-missed-wake")
    expect(row.plane).toBe("owner")
    expect(row.retries).toBe(3)
    expect(row.escalate).toBe("owner-alert")
  })

  it("spend-limit-100 is platform-enforced with customer nudge", () => {
    const row = getHealPolicy("spend-limit-100")
    expect(row.ruling).toBe("platform")
    expect(row.existingHeal).toBe("enforceSpendLimit")
    expect(row.escalate).toBe("customer-alert")
  })

  it("MUTATION: deployer must import trySyncNow (no private duplicate)", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/openclaw/deployer.ts"), "utf8")
    expect(src).toMatch(/from ['"]\.\/sync-now['"]/)
    expect(src).not.toMatch(/async function trySyncNow/)
  })
})
