/**
 * Tooltip class-kill grep-guard (#291 pattern).
 * Only the DS Tooltip file may import the Radix tooltip package or hand-roll
 * portal tooltip bubbles. MUTATION: add a rogue import/div → this fails.
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = join(process.cwd(), "src")
const DS_TOOLTIP = "components/ui/tooltip.tsx"
// Split so this test file does not self-match the import scan.
const RADIX_PKG = ["@radix-ui", "react-tooltip"].join("/")

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (name === "node_modules" || name === ".next") continue
      walk(full, out)
    } else if (/\.(tsx?|jsx?)$/.test(name)) {
      out.push(full)
    }
  }
  return out
}

function isProdSource(rel: string): boolean {
  if (rel === DS_TOOLTIP) return false
  if (rel.includes("/__tests__/")) return false
  if (rel.endsWith(".test.ts") || rel.endsWith(".test.tsx")) return false
  return true
}

describe("tooltip class-kill grep-guard", () => {
  it("no Radix tooltip package import outside DS tooltip.tsx", () => {
    const importRe = new RegExp(`from\\s+["']${RADIX_PKG.replace("/", "\\/")}["']`)
    const offenders: string[] = []
    for (const file of walk(ROOT)) {
      const rel = relative(ROOT, file).replace(/\\/g, "/")
      if (!isProdSource(rel)) continue
      const src = readFileSync(file, "utf8")
      if (importRe.test(src)) offenders.push(rel)
    }
    expect(offenders, `rogue radix tooltip imports: ${offenders.join(", ")}`).toEqual([])
  })

  it("no hand-rolled portal tooltip bubbles outside DS tooltip.tsx", () => {
    const offenders: string[] = []
    for (const file of walk(ROOT)) {
      const rel = relative(ROOT, file).replace(/\\/g, "/")
      if (!isProdSource(rel)) continue
      const src = readFileSync(file, "utf8")
      const hasPortal = /createPortal\s*\(/.test(src)
      const hasTipRole = /role\s*=\s*["']tooltip["']/.test(src)
      const hasManualShell = /fixed\s+z-\[9999\].*pointer-events-none|pointer-events-none.*fixed\s+z-\[9999\]/.test(
        src,
      )
      if ((hasPortal && hasTipRole) || (hasPortal && hasManualShell)) {
        offenders.push(rel)
      }
    }
    expect(offenders, `rogue manual tooltips: ${offenders.join(", ")}`).toEqual([])
  })

  it("DS tooltip keeps Portal + avoidCollisions (engine contract)", () => {
    const src = readFileSync(join(ROOT, DS_TOOLTIP), "utf8")
    expect(src).toContain("TooltipPrimitive.Portal")
    expect(src).toMatch(/avoidCollisions(?:\s*=\s*\{?\s*true\s*\}?)?/)
    expect(src).toContain("sideOffset={6}")
    // MUTATION: strip Portal or avoidCollisions → this fails.
  })
})
