/**
 * prisma/migrations/ may only contain:
 *   - migration_lock.toml
 *   - timestamped family directories (NNNNNNNNNNNNNN_name/migration.sql)
 *
 * Stray scripts there become promote-guard passengers (HWD's comment-only
 * edit of cleanup-drifted-paused-workspaces.ts named a second path vs main).
 */
import { describe, expect, it } from "vitest"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const MIGRATIONS_ROOT = join(process.cwd(), "prisma/migrations")
const FAMILY_DIR = /^\d{14}_[a-z0-9_]+$/
const ALLOWED_ROOT_FILE = "migration_lock.toml"
const FAMILY_FROM_DIFF = /^prisma\/migrations\/(\d{14}_[^/]+)\/.*$/

function rootLayoutViolations(names: string[]): string[] {
  return names.filter((n) => n !== ALLOWED_ROOT_FILE && !FAMILY_DIR.test(n))
}

function familiesFromDiffPaths(paths: string[]): string[] {
  const out = new Set<string>()
  for (const p of paths) {
    const m = p.replaceAll("\\", "/").match(FAMILY_FROM_DIFF)
    if (m) out.add(m[1])
  }
  return [...out].sort()
}

describe("prisma/migrations layout", () => {
  it("root contains only migration_lock.toml and timestamped family directories", () => {
    const names = readdirSync(MIGRATIONS_ROOT)
    expect(rootLayoutViolations(names)).toEqual([])
    expect(names).toContain(ALLOWED_ROOT_FILE)
    const dirs = names.filter((n) => statSync(join(MIGRATIONS_ROOT, n)).isDirectory())
    expect(dirs.length).toBeGreaterThan(0)
    for (const dir of dirs) {
      expect(FAMILY_DIR.test(dir), dir).toBe(true)
      expect(existsSync(join(MIGRATIONS_ROOT, dir, "migration.sql")), dir).toBe(true)
    }
  })

  it("MUTATION: a stray .ts at prisma/migrations/ root fails the layout check", () => {
    const names = readdirSync(MIGRATIONS_ROOT)
    const mutated = [...names, "cleanup-drifted-paused-workspaces.ts"]
    expect(rootLayoutViolations(mutated)).toContain("cleanup-drifted-paused-workspaces.ts")
    expect(rootLayoutViolations(names)).toEqual([])
  })

  it("wave families ignore non-SQL passengers; governor family is one name", () => {
    const paths = [
      "prisma/migrations/20260819120000_railway_deploy_governor/migration.sql",
      "prisma/migrations/cleanup-drifted-paused-workspaces.ts",
    ]
    expect(familiesFromDiffPaths(paths)).toEqual(["20260819120000_railway_deploy_governor"])
  })

  it("MUTATION: ACK on raw path list would name the stray script (families-only must drop it)", () => {
    const paths = [
      "prisma/migrations/20260819120000_railway_deploy_governor/migration.sql",
      "prisma/migrations/cleanup-drifted-paused-workspaces.ts",
    ]
    expect(paths.sort()).toHaveLength(2)
    expect(familiesFromDiffPaths(paths)).toHaveLength(1)
  })

  it("ci.yml layout guard step exists (fail-closed before npm)", () => {
    const yml = readFileSync(join(process.cwd(), ".github/workflows/ci.yml"), "utf8")
    expect(yml).toContain("Guard prisma/migrations layout (families only)")
    expect(yml).toContain("migration_lock.toml")
    expect(yml).toContain("^[0-9]{14}_[a-z0-9_]+$")
  })
})
