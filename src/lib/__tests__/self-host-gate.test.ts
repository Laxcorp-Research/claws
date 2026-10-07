import { afterEach, describe, expect, it } from "vitest"
import {
  HOSTED_ONLY_MODULES,
  assertHostedModule,
  denyHostedOnly,
  HostedOnlyUnavailableError,
} from "@/lib/profile"

afterEach(() => {
  delete process.env.CLAWS_PROFILE
})

describe("CLAWS_PROFILE=self-host hosted-only gate", () => {
  it("every hosted-only module throws under self-host and is allowed when hosted", () => {
    for (const name of HOSTED_ONLY_MODULES) {
      expect(() => assertHostedModule(name)).not.toThrow()
    }
    process.env.CLAWS_PROFILE = "self-host"
    for (const name of HOSTED_ONLY_MODULES) {
      expect(() => assertHostedModule(name)).toThrow(HostedOnlyUnavailableError)
    }
  })

  it("mutation: dodo checkout is unreachable in self-host and reachable when hosted", () => {
    expect(denyHostedOnly("/api/dodo-payments/checkout")).toBeNull()
    process.env.CLAWS_PROFILE = "self-host"
    expect(denyHostedOnly("/api/dodo-payments/checkout")?.moduleName).toBe("dodo-payments")
    expect(denyHostedOnly("/api/cron/hibernation")?.moduleName).toBe("vercel-cron")
    expect(denyHostedOnly("/api/internal/metering/report-batch")?.moduleName).toBe("metering")
    expect(denyHostedOnly("/api/tools/ws/oauth/initiate")?.moduleName).toBe("composio")
    expect(denyHostedOnly("/api/setup/owner")).toBeNull()
    expect(denyHostedOnly("/api/workspaces")).toBeNull()
    expect(denyHostedOnly("/api/internal/state/disk")).toBeNull()
  })

  it("mutation: calling the dodo checkout module and the railway governor under self-host fails", async () => {
    process.env.CLAWS_PROFILE = "self-host"
    const { POST } = await import("@/app/api/dodo-payments/checkout/route")
    const res = await POST(new Request("http://localhost/api/dodo-payments/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "platform" }),
    }) as never)
    expect(res.status).toBe(404)

    const { evaluateCreateBudget } = await import("@/lib/railway/governor")
    await expect(evaluateCreateBudget()).rejects.toThrow(/railway-governor/)
  })
})
