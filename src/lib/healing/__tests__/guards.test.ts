import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  AUTO_REDEPLOY_BACKOFF_MS,
  AUTO_REDEPLOY_CAP_24H,
  AUTO_REDEPLOY_CONDITIONS,
  AUTO_REDEPLOY_GUARD_NAMES,
  AUTO_REDEPLOY_IDLE_MS,
  CRASH_RESTART_BACKOFF_MS,
  CRASH_RESTART_CAP_PER_HOUR,
  CRASH_RESTART_GUARD_NAMES,
  evaluateAutoRedeployGuards,
  evaluateCrashRestartGuards,
  evaluateSilentWakeGuards,
  isTransientDeployError,
  MAX_TRANSIENT_DEPLOY_ATTEMPTS,
  SILENT_WAKE_BACKOFF_MS,
  SILENT_WAKE_CAP_24H,
  withTransientDeployRetry,
} from "@/lib/healing/guards"

const NOW = new Date("2026-08-31T12:00:00.000Z")

describe("auto-redeploy guard matrix", () => {
  it("lists the four ACK'd guards", () => {
    expect([...AUTO_REDEPLOY_GUARD_NAMES]).toEqual([
      "sync-succeeded",
      "idle-5min",
      "backoff",
      "cap",
    ])
  })

  it("MUTATION: any guard removed → fail", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/healing/guards.ts"), "utf8")
    for (const name of AUTO_REDEPLOY_GUARD_NAMES) {
      expect(src).toContain(`"${name}"`)
    }
    expect(src).toContain("if (!input.syncSucceeded)")
    expect(src).toContain("AUTO_REDEPLOY_IDLE_MS")
    expect(src).toContain("AUTO_REDEPLOY_BACKOFF_MS")
    expect(src).toContain("AUTO_REDEPLOY_CAP_24H")
    expect(src).not.toContain("fingerprint-config-drift")
    expect([...AUTO_REDEPLOY_CONDITIONS]).toEqual([
      "bad-token",
      "plugin-not-loaded",
      "mcp-session-dead",
      "thinking-signature-poison",
      "probe-degraded",
    ])
  })

  it("each guard can block alone", () => {
    const base = {
      syncSucceeded: true,
      idleMs: AUTO_REDEPLOY_IDLE_MS,
      attemptsInWindow: 0,
      lastAttemptAt: null as Date | null,
      now: NOW,
    }
    expect(evaluateAutoRedeployGuards(base).allowed).toBe(true)
    expect(evaluateAutoRedeployGuards({ ...base, syncSucceeded: false }).blockedBy).toBe(
      "sync-succeeded",
    )
    expect(evaluateAutoRedeployGuards({ ...base, idleMs: AUTO_REDEPLOY_IDLE_MS - 1 }).blockedBy).toBe(
      "idle-5min",
    )
    expect(
      evaluateAutoRedeployGuards({
        ...base,
        attemptsInWindow: 1,
        lastAttemptAt: new Date(NOW.getTime() - AUTO_REDEPLOY_BACKOFF_MS[1] + 1000),
      }).blockedBy,
    ).toBe("backoff")
    const cap = evaluateAutoRedeployGuards({
      ...base,
      attemptsInWindow: AUTO_REDEPLOY_CAP_24H,
    })
    expect(cap.blockedBy).toBe("cap")
    expect(cap.escalateOwner).toBe(true)
  })
})

describe("crash-restart guard matrix", () => {
  it("MUTATION: any crash guard removed → fail", () => {
    expect([...CRASH_RESTART_GUARD_NAMES]).toEqual(["sync-if-possible", "backoff", "cap"])
    const src = readFileSync(join(process.cwd(), "src/lib/healing/guards.ts"), "utf8")
    expect(src).toContain("sync-if-possible")
    expect(src).toContain("CRASH_RESTART_BACKOFF_MS")
    expect(src).toContain("CRASH_RESTART_CAP_PER_HOUR")
    expect(CRASH_RESTART_BACKOFF_MS[0]).toBe(30_000)
    expect(CRASH_RESTART_BACKOFF_MS[1]).toBe(2 * 60 * 1000)
    expect(CRASH_RESTART_BACKOFF_MS[2]).toBe(10 * 60 * 1000)
  })

  it("caps at 5/h then owner", () => {
    const blocked = evaluateCrashRestartGuards({
      attemptsInHour: CRASH_RESTART_CAP_PER_HOUR,
      lastAttemptAt: null,
      now: NOW,
    })
    expect(blocked.blockedBy).toBe("cap")
    expect(blocked.escalateOwner).toBe(true)
    expect(
      evaluateCrashRestartGuards({
        attemptsInHour: 1,
        lastAttemptAt: new Date(NOW.getTime() - 10_000),
        now: NOW,
      }).blockedBy,
    ).toBe("backoff")
  })
})

describe("silent-wake guard matrix", () => {
  it("caps at 3/24h then owner; first attempt has zero backoff", () => {
    expect(SILENT_WAKE_CAP_24H).toBe(3)
    expect(SILENT_WAKE_BACKOFF_MS[0]).toBe(0)
    const first = evaluateSilentWakeGuards({
      attemptsInWindow: 0,
      lastAttemptAt: null,
      now: NOW,
    })
    expect(first.allowed).toBe(true)
    const capped = evaluateSilentWakeGuards({
      attemptsInWindow: SILENT_WAKE_CAP_24H,
      lastAttemptAt: null,
      now: NOW,
    })
    expect(capped.blockedBy).toBe("cap")
    expect(capped.escalateOwner).toBe(true)
  })
})

describe("transient deploy retry", () => {
  it("retries 502 once then succeeds; never retries NotAuthorized", async () => {
    expect(MAX_TRANSIENT_DEPLOY_ATTEMPTS).toBe(2)
    expect(isTransientDeployError(new Error("HTTP 502"))).toBe(true)
    expect(isTransientDeployError(new Error("NotAuthorized"))).toBe(false)
    let n = 0
    const out = await withTransientDeployRetry(async () => {
      n += 1
      if (n === 1) throw new Error("ETIMEDOUT")
      return "ok"
    })
    expect(out).toBe("ok")
    expect(n).toBe(2)
    await expect(
      withTransientDeployRetry(async () => {
        throw new Error("NotAuthorized")
      }),
    ).rejects.toThrow(/NotAuthorized/)
  })
})
