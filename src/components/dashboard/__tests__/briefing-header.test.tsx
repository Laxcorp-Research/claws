// @vitest-environment jsdom
//
// PR-6: the briefing greeting + health pill. Guards: (1) the serif greeting
// uses the user's first name with a graceful fallback, (2) the health pill is
// quiet when healthy and loud (correct label) when not.

import { describe, it, expect, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { BriefingHeader, clawGreeting, healthPill } from "@/components/dashboard/briefing-header"

afterEach(() => cleanup())

describe("BriefingHeader", () => {
  it("renders without crashing and greets by first name", () => {
    render(<BriefingHeader name="Diana Prince" status="RUNNING" healthStatus="HEALTHY" />)
    expect(screen.getByText(/, Diana\./)).toBeTruthy()
  })

  it("renders the healthy pill quietly", () => {
    render(<BriefingHeader name="Diana" status="RUNNING" healthStatus="HEALTHY" />)
    expect(screen.getByRole("status").textContent).toContain("All healthy")
  })

  it("renders a loud pill when not responding", () => {
    render(<BriefingHeader name="Diana" status="ERROR" healthStatus="UNHEALTHY" />)
    expect(screen.getByRole("status").textContent).toContain("Not responding")
  })

  it("falls back to 'there' when name is missing", () => {
    render(<BriefingHeader name={null} status="RUNNING" healthStatus="HEALTHY" />)
    expect(screen.getByText(/, there\./)).toBeTruthy()
  })
})

describe("clawGreeting", () => {
  it("uses the first word of a multi-word name", () => {
    expect(clawGreeting("Ada Lovelace")).toMatch(/, Ada\.$/)
  })

  it("falls back to 'there' for empty/nullish names", () => {
    expect(clawGreeting("")).toMatch(/, there\.$/)
    expect(clawGreeting(null)).toMatch(/, there\.$/)
    expect(clawGreeting(undefined)).toMatch(/, there\.$/)
  })
})

describe("healthPill precedence", () => {
  it("lifecycle states are muted/info, not loud health", () => {
    expect(healthPill("PAUSED", "HEALTHY")).toEqual({ label: "Paused", tone: "muted" })
    expect(healthPill("STOPPED", "HEALTHY")).toEqual({ label: "Stopped", tone: "muted" })
    expect(healthPill("HIBERNATED", "HEALTHY")).toEqual({ label: "Hibernating", tone: "muted" })
    expect(healthPill("WAKING", "HEALTHY")).toEqual({ label: "Waking up", tone: "info" })
  })

  it("ERROR status or UNHEALTHY health → loud error pill", () => {
    expect(healthPill("ERROR", "HEALTHY")).toEqual({ label: "Not responding", tone: "error" })
    expect(healthPill("RUNNING", "UNHEALTHY")).toEqual({ label: "Not responding", tone: "error" })
  })

  it("DEGRADED distinguishes config drift from generic issues", () => {
    expect(healthPill("RUNNING", "DEGRADED", "bad-token")).toEqual({ label: "Older config", tone: "warn" })
    expect(healthPill("RUNNING", "DEGRADED", "plugin-errors")).toEqual({ label: "Needs attention", tone: "warn" })
  })

  it("running + healthy → quiet ok pill", () => {
    expect(healthPill("RUNNING", "HEALTHY")).toEqual({ label: "All healthy", tone: "ok" })
  })
})
