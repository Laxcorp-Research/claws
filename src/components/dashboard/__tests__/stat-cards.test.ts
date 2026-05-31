// PR-4: the "Agents running" subtext precedence. The pre-PR-4 subtext was a
// hardcoded "All healthy" whenever no agents were paused — it lied when agents
// were offline/error/degraded. agentsSubtext() derives the truthful line with
// precedence error > offline > degraded > paused > healthy, and lifecycle
// labels (paused/stopped/hibernated workspaces) take precedence over all.

import { describe, it, expect } from "vitest"
import { agentsSubtext } from "@/components/dashboard/stat-cards"

const base = { agentsError: 0, agentsOffline: 0, agentsDegraded: 0, agentsPaused: 0 }

describe("agentsSubtext precedence", () => {
  it("all healthy → green 'All healthy'", () => {
    expect(agentsSubtext({ ...base })).toEqual({ text: "All healthy", type: "up" })
  })

  it("error beats everything else (red)", () => {
    expect(
      agentsSubtext({ agentsError: 2, agentsOffline: 1, agentsDegraded: 3, agentsPaused: 1 }),
    ).toEqual({ text: "2 not responding", type: "down" })
  })

  it("offline beats degraded + paused (red)", () => {
    expect(
      agentsSubtext({ ...base, agentsOffline: 3, agentsDegraded: 1, agentsPaused: 2 }),
    ).toEqual({ text: "3 offline", type: "down" })
  })

  it("degraded beats paused (amber/warn)", () => {
    expect(
      agentsSubtext({ ...base, agentsDegraded: 2, agentsPaused: 1 }),
    ).toEqual({ text: "2 degraded", type: "warn" })
  })

  it("paused only → amber 'N paused'", () => {
    expect(agentsSubtext({ ...base, agentsPaused: 4 })).toEqual({ text: "4 paused", type: "warn" })
  })

  it("MUTATION-anchored: a single error must NOT read as 'All healthy'", () => {
    const r = agentsSubtext({ ...base, agentsError: 1 })
    // If precedence is broken (falls through to the healthy default), this
    // catches the exact tautology PR-4 closes: a red banner up top while the
    // StatCard says green "All healthy".
    expect(r.text).not.toBe("All healthy")
    expect(r.type).not.toBe("up")
    expect(r.text).toBe("1 not responding")
  })

  describe("lifecycle labels take precedence over per-agent health", () => {
    it("hibernated → 'Will wake on schedule' (warn) regardless of counts", () => {
      expect(
        agentsSubtext({ agentsError: 5, agentsOffline: 5, agentsDegraded: 5, agentsPaused: 5, isHibernated: true }),
      ).toEqual({ text: "Will wake on schedule", type: "warn" })
    })

    it("stopped → 'Restart to revive' (red)", () => {
      expect(agentsSubtext({ ...base, agentsOffline: 5, isStopped: true })).toEqual({
        text: "Restart to revive",
        type: "down",
      })
    })

    it("paused workspace → 'Resume to continue' (warn)", () => {
      expect(agentsSubtext({ ...base, agentsPaused: 5, isPaused: true })).toEqual({
        text: "Resume to continue",
        type: "warn",
      })
    })
  })
})
