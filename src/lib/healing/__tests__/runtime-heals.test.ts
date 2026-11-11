import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { planHealthRuntimeHeal } from "@/lib/healing/runtime-heals"
import { AUTO_REDEPLOY_CONDITIONS } from "@/lib/healing/guards"
import { getHealPolicy, HEAL_REGISTRY } from "@/lib/healing/registry"
import { PHASE_A_CONDITION_IDS } from "@/lib/healing/conditions"

describe("planHealthRuntimeHeal", () => {
  it("maps degraded family onto auto-redeploy conditions", () => {
    expect(
      planHealthRuntimeHeal({
        probeKind: "degraded",
        probeReason: "bad-token",
        heartbeatMissedAt: null,
        mcpSessionHealthStatus: null,
        containerPhase: "RUNNING",
      }),
    ).toEqual({ condition: "bad-token", family: "auto-redeploy" })
    expect(
      planHealthRuntimeHeal({
        probeKind: "degraded",
        probeReason: "plugin-errors",
        heartbeatMissedAt: null,
        mcpSessionHealthStatus: null,
        containerPhase: "RUNNING",
      }),
    ).toEqual({ condition: "probe-degraded", family: "auto-redeploy" })
    expect(
      planHealthRuntimeHeal({
        probeKind: "healthy",
        probeReason: null,
        heartbeatMissedAt: null,
        mcpSessionHealthStatus: "DEAD",
        containerPhase: "RUNNING",
      }),
    ).toEqual({ condition: "mcp-session-dead", family: "auto-redeploy" })
  })

  it("does not auto-heal drift; crash and heartbeat re-arm stay distinct", () => {
    expect(
      planHealthRuntimeHeal({
        probeKind: "healthy",
        probeReason: "fingerprint-config-drift",
        heartbeatMissedAt: null,
        mcpSessionHealthStatus: null,
        containerPhase: "RUNNING",
      }),
    ).toBeNull()
    expect(
      planHealthRuntimeHeal({
        probeKind: "failure",
        probeReason: "timeout",
        heartbeatMissedAt: null,
        mcpSessionHealthStatus: null,
        containerPhase: "RUNNING",
      }),
    ).toEqual({ condition: "probe-failure", family: "crash-restart" })
    expect(
      planHealthRuntimeHeal({
        probeKind: "healthy",
        probeReason: null,
        heartbeatMissedAt: new Date(),
        mcpSessionHealthStatus: null,
        containerPhase: "RUNNING",
      }),
    ).toEqual({ condition: "heartbeat-missed-running", family: "heartbeat-rearm" })
  })
})

describe("B-2 registry rows", () => {
  it("covers Phase-A ids plus mission_interrupted", () => {
    expect(PHASE_A_CONDITION_IDS).toHaveLength(46)
    expect(PHASE_A_CONDITION_IDS).toContain("mission_interrupted")
    expect(PHASE_A_CONDITION_IDS).toContain("pending-approval-unactioned")
    expect(PHASE_A_CONDITION_IDS).toContain("railway-domain-cap")
    expect(PHASE_A_CONDITION_IDS).toContain("silent-wake")
    expect(PHASE_A_CONDITION_IDS).toContain("digest-missed")
    expect(PHASE_A_CONDITION_IDS).toContain("provider_auth_missing")
    expect(PHASE_A_CONDITION_IDS).toContain("sync-failed-http-401")
    expect(Object.keys(HEAL_REGISTRY)).toHaveLength(46)
    expect(getHealPolicy("mission_interrupted").existingHeal).toBe("auto-resume on wake")
    expect(getHealPolicy("fingerprint-config-drift").existingHeal).toContain("banner-only")
    expect(getHealPolicy("version-update").existingHeal).toBe("apply at next wake")
    for (const id of AUTO_REDEPLOY_CONDITIONS) {
      expect(getHealPolicy(id).existingHeal).toContain("auto-redeploy")
    }
  })

  it("MUTATION: drift must not join the auto-redeploy family", () => {
    expect(AUTO_REDEPLOY_CONDITIONS as readonly string[]).not.toContain(
      "fingerprint-config-drift",
    )
    expect(AUTO_REDEPLOY_CONDITIONS as readonly string[]).not.toContain("version-update")
    const wake = readFileSync(join(process.cwd(), "src/lib/hibernation/manager.ts"), "utf8")
    expect(wake).toContain("deployToCloud")
    expect(wake).toContain("maybeResumeInterruptedMission")
    expect(wake).toContain("version-update applies here")
  })
})

describe("thinking-signature-poison auto-redeploy", () => {
  it("MUTATION: chatting idle-5min must not block poison heal", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/healing/runtime-heals.ts"), "utf8")
    expect(src).toContain('args.condition === "thinking-signature-poison"')
    expect(src).toContain("skipIdle: poison")
    expect(src).toContain("excludeBlocked: poison")
    expect(src).toContain("scheduleThinkingSignatureHeal")
  })
})
