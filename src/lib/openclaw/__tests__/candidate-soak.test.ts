import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  KEEP_CANARY_WORKSPACE_ID,
  decideCandidateSoak,
  isCandidateSoakRuntimeAllowed,
  isKeepCanaryWorkspace,
  mayDeployCandidateImage,
} from "@/lib/openclaw/candidate-soak"

const KEEP = "cmr3fo19r000404jlze8o7dm8"
const CLONE = "cmtfb3a9k000404l9df96h5wd"

describe("candidate soak gate (RUNTIME-9.4 PR-2)", () => {
  it("KEEP canary id is the archive Twitter/X Growth Machine (5)", () => {
    expect(KEEP_CANARY_WORKSPACE_ID).toBe(KEEP)
    expect(isKeepCanaryWorkspace(KEEP)).toBe(true)
    expect(isKeepCanaryWorkspace(CLONE)).toBe(false)
  })

  it("never allows KEEP even when flagged on staging", () => {
    expect(
      decideCandidateSoak({
        workspaceId: KEEP,
        candidateSoak: true,
        env: { CLAWS_ENV: "staging" },
      }),
    ).toEqual({ allowed: false, reason: "keep-canary" })
    expect(
      mayDeployCandidateImage({
        workspaceId: KEEP,
        candidateSoak: true,
        env: { CLAWS_ENV: "staging", NODE_ENV: "test" },
      }),
    ).toBe(false)
  })

  it("never allows production CLAWS_ENV even when flagged", () => {
    expect(isCandidateSoakRuntimeAllowed({ CLAWS_ENV: "production" })).toBe(false)
    expect(
      decideCandidateSoak({
        workspaceId: CLONE,
        candidateSoak: true,
        env: { CLAWS_ENV: "production", NODE_ENV: "test" },
      }),
    ).toEqual({ allowed: false, reason: "production" })
  })

  it("staging Vercel production deploy can still soak when CLAWS_ENV=staging", () => {
    expect(
      isCandidateSoakRuntimeAllowed({
        CLAWS_ENV: "staging",
        VERCEL_ENV: "production",
      }),
    ).toBe(true)
    expect(
      mayDeployCandidateImage({
        workspaceId: CLONE,
        candidateSoak: true,
        env: { CLAWS_ENV: "staging", VERCEL_ENV: "production" },
      }),
    ).toBe(true)
  })

  it("unflagged staging clone stays on isStable", () => {
    expect(
      decideCandidateSoak({
        workspaceId: CLONE,
        candidateSoak: false,
        env: { CLAWS_ENV: "staging" },
      }),
    ).toEqual({ allowed: false, reason: "unflagged" })
    expect(
      mayDeployCandidateImage({
        workspaceId: CLONE,
        env: { CLAWS_ENV: "staging" },
      }),
    ).toBe(false)
  })

  it("flagged staging clone is allowed", () => {
    expect(
      decideCandidateSoak({
        workspaceId: CLONE,
        candidateSoak: true,
        env: { CLAWS_ENV: "staging" },
      }),
    ).toEqual({ allowed: true })
  })

  it("MUTATION: deployer must consult mayDeployCandidateImage before isLatest", () => {
    const deployer = readFileSync(
      join(process.cwd(), "src/lib/openclaw/deployer.ts"),
      "utf8",
    )
    expect(deployer).toContain("mayDeployCandidateImage")
    const resolveFn = deployer.slice(deployer.indexOf("export async function resolveDeployImage"))
    const isLatestIdx = resolveFn.indexOf("isLatest: true")
    const gateIdx = resolveFn.indexOf("mayDeployCandidateImage")
    expect(gateIdx).toBeGreaterThanOrEqual(0)
    expect(isLatestIdx).toBeGreaterThan(gateIdx)
  })

  it("MUTATION: dashboard PATCH allowlist must not include candidateRuntimeSoak", () => {
    const src = readFileSync(
      join(process.cwd(), "src/app/api/workspaces/[id]/route.ts"),
      "utf8",
    )
    expect(src).not.toMatch(/["']candidateRuntimeSoak["']/)
  })
})
