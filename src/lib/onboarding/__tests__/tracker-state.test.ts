import { describe, expect, it } from "vitest"
import {
  deriveTrackerState,
  isStep3Complete,
  resolveStep3Action,
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

describe("isStep3Complete / S3 predicate", () => {
  it("requires BOTH a tool connection and a COMPLETED deployment", () => {
    expect(isStep3Complete({ hasToolConnection: true, hasCompletedDeployment: true })).toBe(true)
    expect(isStep3Complete({ hasToolConnection: true, hasCompletedDeployment: false })).toBe(false)
    expect(isStep3Complete({ hasToolConnection: false, hasCompletedDeployment: true })).toBe(false)
  })

  it("once-deployed-now-STOPPED still counts (Deployment COMPLETED, not Workspace RUNNING)", () => {
    const state = deriveTrackerState({
      providers: ["ANTHROPIC"],
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
    expect(state.deployedWorkspaceId).toBe("w1")
  })

  it("MUTATION: S3 must not require Workspace.status===RUNNING", async () => {
    const { readFileSync } = await import("node:fs")
    const { join } = await import("node:path")
    const src = readFileSync(join(process.cwd(), "src/lib/onboarding/tracker-state.ts"), "utf8")
    expect(src).toContain("hasCompletedDeployment")
    expect(src).not.toMatch(/status\s*===\s*["']RUNNING["'].*s3|s3.*status\s*===\s*["']RUNNING["']/)
  })
})

describe("deriveTrackerState matrix", () => {
  it("all grey when empty", () => {
    const state = deriveTrackerState({
      providers: [],
      workspaces: [],
      hasToolConnection: false,
      hasCompletedDeployment: false,
    })
    expect(state).toMatchObject({
      s1Done: false,
      s2Done: false,
      s3Done: false,
      allDone: false,
    })
  })

  it("S1+S2 green, S3 grey without deploy", () => {
    const state = deriveTrackerState({
      providers: ["OPENAI"],
      workspaces: [ws({ id: "w1", name: "A", status: "SETUP_INCOMPLETE" })],
      hasToolConnection: true,
      hasCompletedDeployment: false,
    })
    expect(state.s1Done).toBe(true)
    expect(state.s2Done).toBe(true)
    expect(state.s3Done).toBe(false)
    expect(state.showAnthropicTemplateHint).toBe(true)
  })

  it("all-green when keys + workspace + tools + COMPLETED deploy", () => {
    const state = deriveTrackerState({
      providers: ["ANTHROPIC"],
      workspaces: [
        ws({ id: "w1", name: "A", status: "RUNNING", hasCompletedDeployment: true }),
      ],
      hasToolConnection: true,
      hasCompletedDeployment: true,
    })
    expect(state.allDone).toBe(true)
  })
})

describe("resolveStep3Action branching", () => {
  it("no-workspace → need-claw (snackbar branch)", () => {
    expect(
      resolveStep3Action({
        s2Done: false,
        s3Done: false,
        workspaces: [],
        deployedWorkspaceId: null,
      }),
    ).toEqual({ type: "need-claw" })
  })

  it("single workspace → direct route by status", () => {
    expect(
      resolveStep3Action({
        s2Done: true,
        s3Done: false,
        workspaces: [ws({ id: "w1", name: "A", status: "SETUP_INCOMPLETE" })],
        deployedWorkspaceId: null,
      }),
    ).toEqual({ type: "direct", href: "/setup/w1/step/1" })

    expect(
      resolveStep3Action({
        s2Done: true,
        s3Done: false,
        workspaces: [ws({ id: "w2", name: "B", status: "DRAFT" })],
        deployedWorkspaceId: null,
      }),
    ).toEqual({ type: "direct", href: "/builder/w2" })
  })

  it("multiple workspaces → picker", () => {
    const action = resolveStep3Action({
      s2Done: true,
      s3Done: false,
      workspaces: [
        ws({ id: "w1", name: "A" }),
        ws({ id: "w2", name: "B", status: "RUNNING" }),
      ],
      deployedWorkspaceId: null,
    })
    expect(action.type).toBe("picker")
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

  it("MUTATION: need-claw branch must remain for snackbar test", async () => {
    const { readFileSync } = await import("node:fs")
    const { join } = await import("node:path")
    const src = readFileSync(join(process.cwd(), "src/lib/onboarding/tracker-state.ts"), "utf8")
    expect(src).toContain('type: "need-claw"')
    expect(src).toMatch(/if\s*\(\s*!args\.s2Done\s*\)\s*return\s*\{\s*type:\s*"need-claw"/)
  })
})

describe("workspaceContinueHref", () => {
  it("routes SETUP_INCOMPLETE / DRAFT / else correctly", () => {
    expect(workspaceContinueHref(ws({ id: "a", name: "A", status: "SETUP_INCOMPLETE" }))).toBe(
      "/setup/a/step/1",
    )
    expect(workspaceContinueHref(ws({ id: "b", name: "B", status: "DRAFT" }))).toBe("/builder/b")
    expect(workspaceContinueHref(ws({ id: "c", name: "C", status: "STOPPED" }))).toBe(
      "/dashboard/c",
    )
  })
})
