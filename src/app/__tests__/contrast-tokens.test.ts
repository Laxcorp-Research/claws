// WCAG 2.1 AA contrast guard for the color tokens touched by the a11y fix.
// Reads the ACTUAL values out of globals.css and computes the ratio, so a
// revert (e.g. --err back to #ef4444, or --danger to a pale red) fails here.
//
// AA normal-text threshold = 4.5:1.
//   - --danger / --caution are solid button backgrounds with WHITE text in
//     BOTH modes → assert white-on-token >= 4.5 in :root AND .dark.
//   - --err / --warn are TEXT colors: light on white bg, dark on the dark bg.

import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8")

function block(selector: string): Record<string, string> {
  const re = new RegExp(`${selector.replace(".", "\\.")}\\s*\\{([\\s\\S]*?)\\}`)
  const body = css.match(re)?.[1] ?? ""
  const map: Record<string, string> = {}
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    map[m[1]] = m[2]
  }
  return map
}

const light = block(":root")
const dark = block(".dark")

function luminance(hex: string): number {
  const n = hex.replace("#", "")
  const ch = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255)
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  const [r, g, b] = ch.map(lin)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const WHITE = "#ffffff"
const AA = 4.5

describe("WCAG AA contrast tokens (a11y fix)", () => {
  it("--danger button: white text passes AA in both modes", () => {
    expect(ratio(WHITE, light["--danger"])).toBeGreaterThanOrEqual(AA)
    expect(ratio(WHITE, dark["--danger"])).toBeGreaterThanOrEqual(AA)
  })

  it("--caution button: white text passes AA in both modes", () => {
    expect(ratio(WHITE, light["--caution"])).toBeGreaterThanOrEqual(AA)
    expect(ratio(WHITE, dark["--caution"])).toBeGreaterThanOrEqual(AA)
  })

  it("--err as text passes AA: light on white, dark on the dark bg", () => {
    expect(ratio(light["--err"], light["--bg"])).toBeGreaterThanOrEqual(AA)
    expect(ratio(dark["--err"], dark["--bg"])).toBeGreaterThanOrEqual(AA)
  })

  it("--warn as text passes AA: light on white, dark on the dark bg", () => {
    expect(ratio(light["--warn"], light["--bg"])).toBeGreaterThanOrEqual(AA)
    expect(ratio(dark["--warn"], dark["--bg"])).toBeGreaterThanOrEqual(AA)
  })

  it("locks the chosen light values (regression: reverting to the failing reds/ambers fails here)", () => {
    expect(light["--err"]).toBe("#dc2626")
    expect(light["--warn"]).toBe("#b45309")
    expect(light["--danger"]).toBe("#dc2626")
    expect(light["--caution"]).toBe("#b45309")
  })
})
