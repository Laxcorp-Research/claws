// GH #5: the v2.5.0 seed must seed its flags/image ONLY on create. On re-run
// against an existing row the `update` must be a no-op ({}), so it can never
// re-assert isStable/isLatest or the ":latest" moving-pointer image (which
// would strand a stale "Latest", create a second isStable row, and reintroduce
// an image record the register endpoint forbids).
//
// Source-level guard (the seed is a side-effecting script, not an exported
// fn). Mutation: restore `update: openClawVersionSeed` (or any flag re-assert)
// → the empty-update assertion fails.

import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const src = readFileSync(resolve(process.cwd(), "prisma/seed.ts"), "utf8")

// Isolate the v2.5.0 upsert call.
const start = src.indexOf('version: "2.5.0"')
const region = src.slice(start, src.indexOf("})", start) + 2)
const updateIdx = region.indexOf("update:")
const createPart = region.slice(0, updateIdx)
const updatePart = region.slice(updateIdx)

describe("prisma/seed.ts v2.5.0 upsert (GH #5)", () => {
  it("seeds the baseline flags + image ONLY on create", () => {
    expect(createPart).toContain("isStable: true")
    expect(createPart).toContain("isLatest: true")
    expect(createPart).toContain(":latest")
  })

  it("update is a no-op {} - never re-asserts isStable/isLatest/dockerImage on re-run", () => {
    // Empty object literal catches both literal flag re-assertion AND the
    // `update: openClawVersionSeed` spread/variable form (the original bug).
    expect(updatePart).toMatch(/update:\s*\{\s*\}/)
    expect(updatePart).not.toContain("isStable")
    expect(updatePart).not.toContain("isLatest")
    expect(updatePart).not.toContain("dockerImage")
  })
})
