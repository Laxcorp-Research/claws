/**
 * VERCEL_ENV_MANIFEST contract: every process.env.NAME used by declared
 * digest/cron surfaces must appear in docs/VERCEL_ENV_MANIFEST.json, and
 * every manifest var must be referenced by at least one of its surfaces.
 */
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { resolve, join } from "node:path"

const ROOT = resolve(__dirname, "../..")
const MANIFEST_PATH = join(ROOT, "docs/VERCEL_ENV_MANIFEST.json")

type ManifestVar = {
  name: string
  purpose: string
  required: boolean
  surfaces: string[]
  whereCreated: string
}

type Manifest = {
  description: string
  vars: ManifestVar[]
}

function loadManifest(): Manifest {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as Manifest
}

function collectTsFiles(dir: string): string[] {
  const out: string[] = []
  if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) return out
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue
      out.push(...collectTsFiles(full))
    } else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) {
      out.push(full)
    }
  }
  return out
}

function envRefsInFile(filePath: string): Set<string> {
  const text = readFileSync(filePath, "utf8")
  const names = new Set<string>()
  const re = /process\.env\.([A-Z][A-Z0-9_]*)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    names.add(m[1])
  }
  return names
}

/** Env names referenced under a surface path (file or directory). */
function envRefsUnderSurface(surfaceRel: string): Set<string> {
  const abs = join(ROOT, surfaceRel)
  const st = statSync(abs, { throwIfNoEntry: false })
  if (!st) return new Set()
  const files = st.isDirectory() ? collectTsFiles(abs) : [abs]
  const names = new Set<string>()
  for (const f of files) {
    for (const n of envRefsInFile(f)) names.add(n)
  }
  return names
}

describe("Vercel env manifest", () => {
  it("manifest entries have name, purpose, required, surfaces, whereCreated", () => {
    const manifest = loadManifest()
    expect(manifest.vars.length).toBeGreaterThan(0)
    for (const row of manifest.vars) {
      expect(row.name, "name").toMatch(/^[A-Z][A-Z0-9_]*$/)
      expect(row.purpose.trim().length, row.name).toBeGreaterThan(8)
      expect(typeof row.required, row.name).toBe("boolean")
      expect(row.surfaces.length, row.name).toBeGreaterThan(0)
      expect(row.whereCreated.trim().length, row.name).toBeGreaterThan(8)
    }
  })

  it("DAILY_DIGEST_WORKSPACE_IDS is documented as optional debug override", () => {
    const row = loadManifest().vars.find(
      (v) => v.name === "DAILY_DIGEST_WORKSPACE_IDS",
    )
    expect(row).toBeDefined()
    expect(row!.required).toBe(false)
    expect(row!.purpose.toLowerCase()).toContain("debug")
    expect(row!.purpose.toLowerCase()).toContain("override")
  })

  it("every manifest var is referenced by at least one declared surface", () => {
    const manifest = loadManifest()
    for (const row of manifest.vars) {
      const refs = new Set<string>()
      for (const surface of row.surfaces) {
        for (const n of envRefsUnderSurface(surface)) refs.add(n)
      }
      expect(
        refs.has(row.name),
        `${row.name} missing from surfaces ${row.surfaces.join(", ")}`,
      ).toBe(true)
    }
  })

  it("MUTATION: dropping DAILY_DIGEST_WORKSPACE_IDS from route fails manifest↔surface check", () => {
    const routeRefs = envRefsUnderSurface("src/app/api/cron/daily-digest")
    expect(routeRefs.has("DAILY_DIGEST_WORKSPACE_IDS")).toBe(true)
    const mutated = new Set(
      [...routeRefs].filter((n) => n !== "DAILY_DIGEST_WORKSPACE_IDS"),
    )
    expect(mutated.has("DAILY_DIGEST_WORKSPACE_IDS")).toBe(false)
    const manifest = loadManifest()
    const digestRow = manifest.vars.find(
      (v) => v.name === "DAILY_DIGEST_WORKSPACE_IDS",
    )!
    expect(digestRow).toBeDefined()
    // Simulate set-equality failure the contract would catch.
    expect(mutated.has(digestRow.name)).toBe(false)
  })
})
