// RESEND ERROR HONESTY - structural adoption lock. The SDK resolves
// `{ error }` instead of throwing, so ANY raw `resend.emails.send` call is a
// silent-failure bug by construction. This test walks src/ and fails if a
// raw send (or a fresh `new Resend(...)` client) appears outside the two
// whitelisted files. New call sites - onboarding emails included, when they
// land - are forced through the sendEmail wrapper by this test.
import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const ROOT = process.cwd()
const SRC = join(ROOT, "src")

/** The only file allowed to invoke the SDK's send. */
const WRAPPER_FILE = "src/lib/email/send-email.ts"
/** The only file allowed to construct the Resend client. */
const CLIENT_FILE = "src/lib/resend.ts"

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      // Generated Prisma client is vendored output, not our code; test files
      // legitimately mock `emails.send` shapes.
      if (entry === "generated" || entry === "__tests__" || entry === "node_modules") continue
      walk(full, out)
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.(test|spec)\.(ts|tsx)$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

function posix(p: string): string {
  return relative(ROOT, p).replace(/\\/g, "/")
}

describe("no raw Resend usage outside the wrapper (grep lock)", () => {
  const files = walk(SRC)

  it("sanity: the walker actually sees the codebase", () => {
    expect(files.length).toBeGreaterThan(100)
  })

  it("`.emails.send(` appears ONLY in the sendEmail wrapper", () => {
    const offenders = files
      .filter((f) => posix(f) !== WRAPPER_FILE)
      .filter((f) => readFileSync(f, "utf8").includes(".emails.send("))
      .map(posix)
    expect(offenders).toEqual([])
  })

  it("`new Resend(` / `from \"resend\"` appear ONLY in the client factory", () => {
    const offenders = files
      .filter((f) => posix(f) !== CLIENT_FILE)
      .filter((f) => {
        const src = readFileSync(f, "utf8")
        return /new Resend\(/.test(src) || /from ["']resend["']/.test(src)
      })
      .map(posix)
    expect(offenders).toEqual([])
  })

  it("MUTATION: the whitelisted files still contain their patterns (lock is not vacuous)", () => {
    const wrapper = readFileSync(join(ROOT, WRAPPER_FILE), "utf8")
    const client = readFileSync(join(ROOT, CLIENT_FILE), "utf8")
    expect(wrapper).toContain(".emails.send(")
    // The wrapper's whole purpose: check the RESOLVED error field.
    expect(wrapper).toMatch(/\.error\b|error\s*\)/)
    expect(wrapper).toContain("if (error)")
    expect(client).toMatch(/new Resend\(/)
  })
})
