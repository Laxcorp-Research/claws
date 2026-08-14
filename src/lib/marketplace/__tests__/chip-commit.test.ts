import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { commitChipDraft, isEnvChipToken } from "@/lib/marketplace/chip-commit"

describe("commitChipDraft", () => {
  it("commits pending typed text into the list", () => {
    expect(commitChipDraft("curl", [], 20)).toEqual({ items: ["curl"], draft: "" })
  })

  it("clears draft when the token is already present", () => {
    expect(commitChipDraft("curl", ["curl"], 20)).toEqual({ items: ["curl"], draft: "" })
  })

  it("keeps invalid env draft so the founder can fix it", () => {
    const r = commitChipDraft("hubspot-key", [], 20, isEnvChipToken)
    expect(r.items).toEqual([])
    expect(r.draft).toBe("hubspot-key")
  })

  it("commits valid UPPER_SNAKE env token", () => {
    expect(commitChipDraft("HUBSPOT_API_KEY", [], 20, isEnvChipToken)).toEqual({
      items: ["HUBSPOT_API_KEY"],
      draft: "",
    })
  })

  it("does not exceed max", () => {
    expect(commitChipDraft("jq", ["a"], 1)).toEqual({ items: ["a"], draft: "jq" })
  })
})

describe("publish skill chip flush wiring", () => {
  it("MUTATION: pending chip draft not flushed on blur/Next → fail", () => {
    const page = readFileSync(join(process.cwd(), "src/app/publish/skill/page.tsx"), "utf8")
    expect(page).toContain("commitChipDraft")
    expect(page).toContain("flushPendingChips")
    expect(page).toMatch(/onBlur=\{.*flushPendingChips/)
    expect(page).toMatch(/onClick=\{\(\) => \{\s*flushPendingChips\(\)/)
  })
})
