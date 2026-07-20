import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  DIR_LIST_TOOL_DENY,
  mergeDirListDenyIntoTools,
} from "@/lib/openclaw/dir-list-deny"

describe("mergeDirListDenyIntoTools", () => {
  it("adds dir_list to empty tools", () => {
    expect(mergeDirListDenyIntoTools(undefined).deny).toEqual([...DIR_LIST_TOOL_DENY])
  })

  it("merges without clobbering existing deny / web", () => {
    const merged = mergeDirListDenyIntoTools({
      deny: ["composio__*"],
      web: { search: { enabled: false } },
    })
    expect(merged.deny).toEqual(["composio__*", "dir_list"])
    expect(merged.web).toEqual({ search: { enabled: false } })
  })

  it("MUTATION: generator must call mergeDirListDenyIntoTools (drop → fail)", () => {
    const src = readFileSync(join(process.cwd(), "src/lib/openclaw/generator.ts"), "utf8")
    expect(src).toContain("mergeDirListDenyIntoTools")
    expect(src).toContain("dir-list-deny")
  })
})
