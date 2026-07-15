/**
 * Adoption guard: every ellipsis-capable text site must use TruncatedText
 * (or TruncateWithTooltip) OR carry an explicit `truncate-allowlist:` comment.
 *
 * MUTATION: add a bare truncate / text-ellipsis / line-clamp class in a
 * source TSX file without TruncatedText and without the allowlist marker
 * on the same or previous line → this suite fails.
 */
import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const SRC_ROOT = join(__dirname, "..")
const MARKER = "truncate-allowlist:"
const COMPONENT_OK = /TruncatedText|TruncateWithTooltip/
const BARE_TRUNCATE =
  /\b(?:truncate|text-ellipsis|line-clamp-\d+)\b/

function walkTsx(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "generated" || name === "__tests__") continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walkTsx(full, out)
    else if (name.endsWith(".tsx")) out.push(full)
  }
  return out
}

function lineHasBareTruncate(line: string): boolean {
  // Ignore comments that are only the allowlist / docs.
  const code = line.replace(/\/\/.*$/, "").replace(/\{\/\*.*?\*\/\}/g, "")
  // TruncatedText's own ellipsis classes are the implementation, not adoption debt.
  if (COMPONENT_OK.test(code)) return false
  if (/overflow-hidden text-ellipsis whitespace-nowrap/.test(code)) return false
  return BARE_TRUNCATE.test(code)
}

function isAllowlisted(lines: string[], index: number): boolean {
  const window = [lines[index], lines[index - 1], lines[index - 2]]
    .filter(Boolean)
    .join("\n")
  return window.includes(MARKER)
}

describe("TruncatedText adoption guard", () => {
  it("flags bare truncate/ellipsis/line-clamp without TruncatedText or allowlist", () => {
    const files = walkTsx(SRC_ROOT)
    const offenders: string[] = []

    for (const file of files) {
      // Implementation + this guard's docs live outside the adoption surface.
      const rel = relative(SRC_ROOT, file).replace(/\\/g, "/")
      if (rel === "components/ui/truncate-with-tooltip.tsx") continue

      const lines = readFileSync(file, "utf8").split(/\r?\n/)
      lines.forEach((line, i) => {
        if (!lineHasBareTruncate(line)) return
        if (isAllowlisted(lines, i)) return
        offenders.push(`${rel}:${i + 1}: ${line.trim()}`)
      })
    }

    expect(offenders, offenders.join("\n")).toEqual([])
  })

  it("MUTATION: introducing a bare truncate class without allowlist fails the guard", () => {
    const sample = [
      'export function Bad() {',
      '  return <div className="truncate">{title}</div>',
      "}",
    ]
    const offenders: string[] = []
    sample.forEach((line, i) => {
      if (!lineHasBareTruncate(line)) return
      if (isAllowlisted(sample, i)) return
      offenders.push(line)
    })
    expect(offenders.length).toBeGreaterThan(0)

    const allowlisted = [
      "  {/* truncate-allowlist: intentional */}",
      '  return <div className="truncate">{title}</div>',
    ]
    const ok: string[] = []
    allowlisted.forEach((line, i) => {
      if (!lineHasBareTruncate(line)) return
      if (isAllowlisted(allowlisted, i)) return
      ok.push(line)
    })
    expect(ok).toEqual([])
  })
})
