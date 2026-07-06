import { describe, expect, it } from "vitest"
import { customApiEnvVarName, deriveCustomApiIdentities } from "@/lib/custom-api-identity"

describe("custom API identity derivation", () => {
  it("derives a stable custom slug and env var from the row name", () => {
    const identities = deriveCustomApiIdentities([
      { id: "cust_1", name: "Internal CRM", createdAt: "2026-07-06T10:00:00.000Z" },
    ])

    expect(identities.get("cust_1")).toEqual({
      id: "cust_1",
      slug: "custom-internal-crm",
      envVar: "CUSTOM_CUSTOM_INTERNAL_CRM_KEY",
    })
    expect(customApiEnvVarName("custom-internal-crm")).toBe("CUSTOM_CUSTOM_INTERNAL_CRM_KEY")
  })

  it("suffixes name collisions deterministically by createdAt then id", () => {
    const identities = deriveCustomApiIdentities([
      { id: "cust_b", name: "Internal CRM", createdAt: "2026-07-06T10:01:00.000Z" },
      { id: "cust_a", name: "Internal CRM", createdAt: "2026-07-06T10:00:00.000Z" },
      { id: "cust_c", name: "Internal CRM", createdAt: "2026-07-06T10:01:00.000Z" },
    ])

    expect(identities.get("cust_a")?.slug).toBe("custom-internal-crm")
    expect(identities.get("cust_b")?.slug).toBe("custom-internal-crm-2")
    expect(identities.get("cust_c")?.slug).toBe("custom-internal-crm-3")
  })
})
