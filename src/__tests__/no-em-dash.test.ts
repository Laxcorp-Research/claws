import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * Founder ruling 2026-08-21: no em dashes anywhere in platform copy; use "-".
 * The sweep replaced 2115 of them. This walk keeps every swept scope clean.
 * Legitimate legacy-content parsers use the \u2014 escape (e.g. the activity
 * route's paused-worker regex), which this literal-character scan ignores.
 */
const EM_DASH = "\u2014"
const SCOPES = ["src", "container", "prisma", "docker"]
const EXTENSIONS = /\.(ts|tsx|js|jsx|mjs|cjs|json|md|sql|prisma|yml|yaml|css)$/

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    if (entry === "node_modules" || entry === "generated" || entry === ".next") return []
    const path = join(dir, entry)
    const stat = statSync(path)
    if (stat.isDirectory()) return walk(path)
    return EXTENSIONS.test(entry) ? [path] : []
  })
}

describe("platform copy: no em dashes", () => {
  it("finds zero literal em dashes in src/, container/, prisma/, docker/", () => {
    const offenders: string[] = []
    for (const scope of SCOPES) {
      const root = join(process.cwd(), scope)
      let files: string[] = []
      try {
        files = walk(root)
      } catch {
        continue
      }
      for (const file of files) {
        const text = readFileSync(file, "utf8")
        if (text.includes(EM_DASH)) {
          const line = text.split("\n").findIndex((l) => l.includes(EM_DASH)) + 1
          offenders.push(`${relative(process.cwd(), file)}:${line}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
