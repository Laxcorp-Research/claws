import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import {
  computeApprovalVersionStates,
  messageFromRespondBody,
  respondFailureMessage,
  versionDayLabel,
} from "@/lib/artifacts/approval-version"

const path = "shared/deliverables/x-content-cycle.md"

describe("approval version states", () => {
  it("marks older NONE versions SUPERSEDED; only latest is decidable", () => {
    const states = computeApprovalVersionStates([
      {
        id: "fv-sep1",
        logicalPath: path,
        version: 1,
        createdAt: new Date("2026-09-01T12:00:00.000Z"),
        decision: "NONE",
      },
      {
        id: "fv-sep2",
        logicalPath: path,
        version: 2,
        createdAt: new Date("2026-09-02T12:00:00.000Z"),
        decision: "NONE",
      },
    ])
    expect(states.get("fv-sep1")).toMatchObject({
      decision: "SUPERSEDED",
      isLatest: false,
      isDecidable: false,
      latestFileVersionId: "fv-sep2",
      latestLabel: "Sep 2",
    })
    expect(states.get("fv-sep2")).toMatchObject({
      decision: "NONE",
      isLatest: true,
      isDecidable: true,
    })
  })

  it("keeps an approved older version Approved, not silent", () => {
    const states = computeApprovalVersionStates([
      {
        id: "fv-1",
        logicalPath: path,
        version: 1,
        createdAt: new Date("2026-09-01T12:00:00.000Z"),
        decision: "APPROVED",
      },
      {
        id: "fv-2",
        logicalPath: path,
        version: 2,
        createdAt: new Date("2026-09-02T12:00:00.000Z"),
        decision: "NONE",
      },
    ])
    expect(states.get("fv-1")?.decision).toBe("APPROVED")
    expect(states.get("fv-1")?.isDecidable).toBe(false)
    expect(states.get("fv-2")?.isDecidable).toBe(true)
  })

  it("formats UTC day labels", () => {
    expect(versionDayLabel(new Date("2026-09-02T21:01:00.000Z"))).toBe("Sep 2")
  })

  it("names respond failures", () => {
    expect(respondFailureMessage("already_approved")).toBe("already approved")
    expect(respondFailureMessage("superseded", "Sep 2")).toBe(
      "superseded by the Sep 2 version - open latest",
    )
    expect(messageFromRespondBody({ error: { message: "already approved" } }, "Could not approve")).toBe(
      "already approved",
    )
    expect(messageFromRespondBody(null, "Could not approve")).toBe("Could not approve")
  })

  it("MUTATION: approval-version stays prisma-free (client-safe)", () => {
    const src = readFileSync(resolve("src/lib/artifacts/approval-version.ts"), "utf8")
    expect(src).not.toContain("@/lib/db")
    expect(src).not.toContain("@prisma")
  })
})
