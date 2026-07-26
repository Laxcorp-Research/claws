import { describe, expect, it } from "vitest"
import {
  deriveTrackerState,
  isStep1Complete,
  isStep3Complete,
  resolveStep3Action,
  shouldShowGettingStartedNav,
  workspaceContinueHref,
  type TrackerWorkspace,
} from "@/lib/onboarding/tracker-state"

const ws = (
  partial: Partial<TrackerWorkspace> & Pick<TrackerWorkspace, "id" | "name">,
): TrackerWorkspace => ({
  status: "DRAFT",
  hasCompletedDeployment: false,
  ...partial,
})

describe("S1v2 predicate matrix", () => {
  it("credits-only → done", () => {
    expect(isStep1Complete({ balanceCents: 5000, providers: [] })).toBe(true)
    const state = deriveTrackerState({
      providers: [],
      balanceCents: 5000,
      workspaces: [],
      hasToolConnection: false,
      hasCompletedDeployment: false,
    })
    expect(state.s1DoneVia).toBe("credits")
  })

  it("key-only → done", () => {
    expect(isStep1Complete({ balanceCents: 0, providers: ["OPENAI"] })).toBe(true)
    expect(isStep1Complete({ balanceCents: null, providers: ["ANTHROPIC"] })).toBe(true)
  })

  it("both → done via both", () => {
    const state = deriveTrackerState({
      providers: ["ANTHROPIC"],
      balanceCents: 1200,
      workspaces: [],
      hasToolConnection: false,
      hasCompletedDeployment: false,
    })
    expect(state.s1Done).toBe(true)
    expect(state.s1DoneVia).toBe("both")
  })

  it("neither → not-done", () => {
    expect(isStep1Complete({ balanceCents: null, providers: [] })).toBe(false)
    expect(isStep1Complete({ balanceCents: 0, providers: [] })).toBe(false)
  })

  it("zero-balance regression with no key → not-done (accepted nudge)", () => {
    // Edge: balance hits 0 with no key → S1v2 regresses — nav reappears as nudge.
    expect(isStep1Complete({ balanceCents: 0, providers: [] })).toBe(false)
    const state = deriveTrackerState({
      providers: [],
      balanceCents: 0,
      workspaces: [ws({ id: "w1", name: "A" })],
      hasToolConnection: true,
      hasCompletedDeployment: true,
    })
    expect(state.s1Done).toBe(false)
    expect(shouldShowGettingStartedNav(state)).toBe(true)
  })
})

describe("isStep3Complete / S3 predicate", () => {
  it("once-deployed-now-STOPPED still counts", () => {
    const state = deriveTrackerState({
      providers: ["ANTHROPIC"],
      balanceCents: 0,
      hasToolConnection: true,
      hasCompletedDeployment: true,
      workspaces: [
        ws({
          id: "w1",
          name: "Stopped Claw",
          status: "STOPPED",
          hasCompletedDeployment: true,
        }),
      ],
    })
    expect(state.s3Done).toBe(true)
  })

  it("requires BOTH tool connection and COMPLETED deployment", () => {
    expect(isStep3Complete({ hasToolConnection: true, hasCompletedDeployment: false })).toBe(false)
  })
})

describe("resolveStep3Action — picker always when S2 done", () => {
  it("no-workspace → need-claw", () => {
    expect(
      resolveStep3Action({
        s2Done: false,
        s3Done: false,
        workspaces: [],
        deployedWorkspaceId: null,
      }),
    ).toEqual({ type: "need-claw" })
  })

  it("single workspace → picker (not direct-route)", () => {
    const workspaces = [ws({ id: "w1", name: "A", status: "SETUP_INCOMPLETE" })]
    expect(
      resolveStep3Action({
        s2Done: true,
        s3Done: false,
        workspaces,
        deployedWorkspaceId: null,
      }),
    ).toEqual({ type: "picker", workspaces })
  })

  it("MUTATION: must not restore n===1 direct-route", async () => {
    const { readFileSync } = await import("node:fs")
    const { join } = await import("node:path")
    const src = readFileSync(join(process.cwd(), "src/lib/onboarding/tracker-state.ts"), "utf8")
    expect(src).not.toMatch(/workspaces\.length === 1/)
    expect(src).toContain('type: "picker"')
  })

  it("S3 complete → dashboard", () => {
    expect(
      resolveStep3Action({
        s2Done: true,
        s3Done: true,
        workspaces: [ws({ id: "w1", name: "A", hasCompletedDeployment: true })],
        deployedWorkspaceId: "w1",
      }),
    ).toEqual({ type: "dashboard", href: "/dashboard/w1" })
  })
})

describe("shouldShowGettingStartedNav", () => {
  it("partial → shown; all-green → hidden", () => {
    expect(
      shouldShowGettingStartedNav({ s1Done: true, s2Done: false, s3Done: false }),
    ).toBe(true)
    expect(
      shouldShowGettingStartedNav({ s1Done: true, s2Done: true, s3Done: true }),
    ).toBe(false)
  })

  it("MUTATION: nav-visibility predicate must stay NOT(all green)", async () => {
    const { readFileSync } = await import("node:fs")
    const { join } = await import("node:path")
    const src = readFileSync(join(process.cwd(), "src/lib/onboarding/tracker-state.ts"), "utf8")
    expect(src).toMatch(/!\(state\.s1Done && state\.s2Done && state\.s3Done\)/)
  })
})

describe("workspaceContinueHref", () => {
  it("routes by status", () => {
    expect(workspaceContinueHref(ws({ id: "a", name: "A", status: "SETUP_INCOMPLETE" }))).toBe(
      "/setup/a/step/1",
    )
    expect(workspaceContinueHref(ws({ id: "b", name: "B", status: "DRAFT" }))).toBe("/builder/b")
  })
})
