import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = process.cwd()

function walkTsx(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__tests__" || name === "admin") continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      walkTsx(full, acc)
      continue
    }
    if (name.endsWith(".tsx") || name.endsWith(".ts")) acc.push(full)
  }
  return acc
}

describe("template-schedule user-facing copy snapshot", () => {
  it("builder picker + banner use template-schedule wording", () => {
    const config = readFileSync(join(ROOT, "src/components/builder/heartbeat-config.tsx"), "utf8")
    const picker = readFileSync(join(ROOT, "src/lib/builder/heartbeat-picker.ts"), "utf8")

    expect(picker).toContain("Runs on its template schedule (${count} window${count === 1 ? \"\" : \"s\"}/day)")
    expect(config).toContain("Replace the template schedule with ${preset}?")
    expect(config).toContain("customHeartbeatLabel(heartbeatSchedule.customWindowCount ?? null)")

    expect(config).not.toContain("HEARTBEAT.md")
    expect(config).not.toMatch(/MD cron/)
    expect(picker).not.toContain("Custom schedule")
    expect(picker).not.toMatch(/Custom \(\$\{count\}/)
  })

  it("MUTATION: HEARTBEAT.md / MD cron restored in buyer UI → fail", () => {
    const userFacingDirs = [
      join(ROOT, "src/components/builder"),
      join(ROOT, "src/app/store"),
      join(ROOT, "src/app/my-claws"),
      join(ROOT, "src/app/setup"),
    ]
    const files = userFacingDirs.flatMap((d) => walkTsx(d))
    const hits: string[] = []
    for (const file of files) {
      if (file.includes(`${join("builder", "__tests__")}`)) continue
      const src = readFileSync(file, "utf8")
      if (src.includes("HEARTBEAT.md") || src.includes("MD cron")) {
        hits.push(file.replace(ROOT, "").replace(/\\/g, "/"))
      }
    }
    expect(hits).toEqual([])
  })
})
