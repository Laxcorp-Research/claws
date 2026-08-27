/**
 * Tooltip grep-guard v2 - static enforcement that cannot rot.
 * MUTATION (manual/CI verification): inject one rogue of each class → matching it() fails → remove.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = join(process.cwd(), "src")
const DS_TOOLTIP = "components/ui/tooltip.tsx"
// Split so this test file does not self-match the import scan.
const RADIX_PKG = ["@radix-ui", "react-tooltip"].join("/")

/**
 * Explicit allowlist for DOM-element `title=` attrs on lowercase JSX tags.
 * Post PR-A this is EMPTY - component title PROPS (Modal/EmptyState/…) stay
 * legal because they use PascalCase tags and are not matched.
 */
const DOM_TITLE_ALLOWLIST: readonly string[] = []

/** Legal createPortal surfaces that are NOT tooltips (modals, menus, toasts). */
const PORTAL_ALLOWLIST: readonly string[] = [
  "components/ui/modal.tsx",
  "components/ui/select.tsx",
  "components/ui/time-picker.tsx",
  "components/shared/snackbar.tsx",
]

function walk(dir: string, out: string[] = [], exts = /\.(tsx?|jsx?)$/): string[] {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (name === "node_modules" || name === ".next") continue
      walk(full, out, exts)
    } else if (exts.test(name)) {
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

/** Strip comments so false positives inside docs/comments don't trip the guard. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
}

/**
 * DOM title= on lowercase HTML/SVG tags only.
 * Distinguishes `<button title="…">` (forbidden) from `<Modal title="…">` (legal).
 */
function findDomTitleOffenders(src: string): boolean {
  const cleaned = stripComments(src)
  return /<[a-z][a-z0-9]*\b(?:[^>"']|"[^"]*"|'[^']*')*\btitle\s*=/.test(cleaned)
}

/** Hover-enter paired with an absolute/fixed tip-shell (z + pointer-events-none). */
function hasHoverTipShell(src: string): boolean {
  const cleaned = stripComments(src)
  const hasHover = /on(?:Mouse|Pointer)Enter\s*=/.test(cleaned)
  if (!hasHover) return false
  return /(?:absolute|fixed)[\s\S]{0,160}z-\[(?:9999|999|50)\][\s\S]{0,120}pointer-events-none|pointer-events-none[\s\S]{0,120}(?:absolute|fixed)[\s\S]{0,160}z-\[(?:9999|999|50)\]/.test(
    cleaned,
  )
}

/** CSS border-triangle caret used as a tooltip arrow (w-0/h-0 + transparent borders). */
function hasCssBorderTriangleTip(src: string): boolean {
  const cleaned = stripComments(src)
  const zeroBox =
    /(?:width:\s*0|w-0)[\s\S]{0,80}(?:height:\s*0|h-0)|(?:height:\s*0|h-0)[\s\S]{0,80}(?:width:\s*0|w-0)/.test(
      cleaned,
    )
  if (!zeroBox) return false
  return /border-(?:t|b|l|r)-(?:transparent|\[transparent\])|border-color:\s*transparent/.test(cleaned)
}

function isPortalTipShell(src: string): boolean {
  const cleaned = stripComments(src)
  const hasPortal = /createPortal\s*\(/.test(cleaned)
  if (!hasPortal) return false
  const hasTipRole = /role\s*=\s*(?:\{\s*)?["']tooltip["']/.test(cleaned)
  const hasManualShell =
    /fixed\s+z-\[9999\][\s\S]{0,80}pointer-events-none|pointer-events-none[\s\S]{0,80}fixed\s+z-\[9999\]/.test(
      cleaned,
    )
  // Portal + hover-label shell: createPortal with tip fill token + pointer-events-none.
  const hasPortalHoverLabel =
    /(?:absolute|fixed)[\s\S]{0,120}bg-\[var\(--tx\)\]/.test(cleaned) &&
    /pointer-events-none/.test(cleaned)
  return hasTipRole || hasManualShell || hasPortalHoverLabel
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

  it("no role=tooltip outside DS tooltip.tsx", () => {
    const offenders: string[] = []
    for (const file of walk(ROOT)) {
      const rel = relative(ROOT, file).replace(/\\/g, "/")
      if (!isProdSource(rel)) continue
      const src = stripComments(readFileSync(file, "utf8"))
      if (/role\s*=\s*(?:\{\s*)?["']tooltip["']/.test(src)) offenders.push(rel)
    }
    expect(offenders, `rogue role=tooltip: ${offenders.join(", ")}`).toEqual([])
  })

  it("no hand-rolled portal tooltip bubbles outside DS tooltip.tsx", () => {
    const offenders: string[] = []
    for (const file of walk(ROOT)) {
      const rel = relative(ROOT, file).replace(/\\/g, "/")
      if (!isProdSource(rel)) continue
      if (PORTAL_ALLOWLIST.includes(rel)) continue
      if (isPortalTipShell(readFileSync(file, "utf8"))) offenders.push(rel)
    }
    expect(offenders, `rogue manual tooltips: ${offenders.join(", ")}`).toEqual([])
  })

  it("no hover-enter + absolute/fixed tip-shell outside DS tooltip.tsx", () => {
    const offenders: string[] = []
    for (const file of walk(ROOT)) {
      const rel = relative(ROOT, file).replace(/\\/g, "/")
      if (!isProdSource(rel)) continue
      if (hasHoverTipShell(readFileSync(file, "utf8"))) offenders.push(rel)
    }
    expect(offenders, `rogue hover tip-shells: ${offenders.join(", ")}`).toEqual([])
  })

  it("no CSS border-triangle tooltip caret patterns in stylesheets", () => {
    const offenders: string[] = []
    for (const file of walk(ROOT, [], /\.css$/)) {
      const rel = relative(process.cwd(), file).replace(/\\/g, "/")
      if (hasCssBorderTriangleTip(readFileSync(file, "utf8"))) offenders.push(rel)
    }
    expect(offenders, `CSS triangle tip offenders: ${offenders.join(", ")}`).toEqual([])
  })

  it("no DOM-element title= attrs on lowercase JSX tags (allowlist empty)", () => {
    const offenders: string[] = []
    for (const file of walk(ROOT)) {
      const rel = relative(ROOT, file).replace(/\\/g, "/")
      if (!isProdSource(rel)) continue
      if (DOM_TITLE_ALLOWLIST.includes(rel)) continue
      if (findDomTitleOffenders(readFileSync(file, "utf8"))) offenders.push(rel)
    }
    expect(
      offenders,
      `DOM title= residuals (component title props are PascalCase and legal): ${offenders.join(", ")}`,
    ).toEqual([])
    // Pin the allowlist empty so a silent allowlist growth fails loudly.
    expect(DOM_TITLE_ALLOWLIST).toEqual([])
  })

  it("DS tooltip keeps Portal + avoidCollisions + viewport boundary (engine contract)", () => {
    const src = readFileSync(join(ROOT, DS_TOOLTIP), "utf8")
    expect(src).toContain("TooltipPrimitive.Portal")
    expect(src).toMatch(/avoidCollisions(?:\s*=\s*\{?\s*true\s*\}?)?/)
    expect(src).toContain("sideOffset={0}")
    expect(src).toContain("collisionPadding={8}")
    expect(src).toContain("document.documentElement")
    expect(src).toContain("TooltipPrimitive.Arrow")
    expect(src).toContain("width={TOOLTIP_ARROW_WIDTH}")
    expect(src).toContain("height={TOOLTIP_ARROW_HEIGHT}")
    // Closing round: no force-visibility class on Arrow (degenerate placement gap).
    expect(src).not.toMatch(/className="[^"]*!visible[^"]*"/)
    // MUTATION: strip Portal / avoidCollisions / Arrow → this fails.
  })
})
