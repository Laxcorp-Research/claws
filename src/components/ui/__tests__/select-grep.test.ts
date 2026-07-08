import { readdirSync, readFileSync, statSync } from "fs"
import { join } from "path"
import { describe, expect, it } from "vitest"

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) return tsxFiles(path)
    return path.endsWith(".tsx") ? [path] : []
  })
}

describe("platform Select cleanup", () => {
  it("has no raw browser select elements in TSX", () => {
    const offenders = tsxFiles(join(process.cwd(), "src"))
      .filter((file) => readFileSync(file, "utf8").includes("<select"))
    expect(offenders).toEqual([])
  })

  it("keeps CustomSelect as a wrapper over the shared Select implementation", () => {
    const source = readFileSync(join(process.cwd(), "src/components/ui/custom-select.tsx"), "utf8")
    expect(source).toContain('import { Select } from "@/components/ui/select"')
    expect(source).not.toContain("role=\"listbox\"")
  })
})
