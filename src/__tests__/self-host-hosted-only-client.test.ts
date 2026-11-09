/**
 * A client file that names a hosted-only route must also name a profile
 * guard. Hiding the control in a parent is not enough: the fetch file
 * itself has to call useSelfHost() or clientIsSelfHost().
 */
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { describe, expect, it } from "vitest"

const SRC = join(process.cwd(), "src")

const HOSTED_ONLY_MARKERS = [
  "/api/dodo-payments",
  "/api/credits",
  "/api/user/billing",
  "/api/fly",
  "/api/cron/service-pool",
  "/byok/",
  "/oauth/initiate",
  "/oauth/disconnect",
]

const GUARD = /useSelfHost\(|clientIsSelfHost\(/

function walk(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    if (name === "api" || name === "__tests__" || name === "node_modules") continue
    const path = join(dir, name)
    if (statSync(path).isDirectory()) {
      out.push(...walk(path))
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(path)
    }
  }
  return out
}

function isClientFile(path: string, source: string): boolean {
  if (source.includes('"use client"') || source.includes("'use client'")) return true
  const rel = relative(SRC, path).replace(/\\/g, "/")
  return rel.startsWith("hooks/") || rel.startsWith("components/") || rel.startsWith("lib/oauth/")
}

describe("self-host client hosted-only routes", () => {
  it("fails when a client file references a HOSTED_ONLY route without a profile guard", () => {
    const unguarded: string[] = []
    for (const path of walk(SRC)) {
      const source = readFileSync(path, "utf8")
      if (!isClientFile(path, source)) continue
      const hit = HOSTED_ONLY_MARKERS.find((marker) => source.includes(marker))
      if (!hit) continue
      if (!GUARD.test(source)) {
        unguarded.push(`${relative(process.cwd(), path)} (${hit})`)
      }
    }
    expect(unguarded).toEqual([])
  })
})
