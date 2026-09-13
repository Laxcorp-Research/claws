#!/usr/bin/env node
/**
 * Clone-tag contract CI vs OpenClaw v2026.9.4 (unsuffixed upstream_tag).
 *
 * Greps the cloned upstream tree for the symbols in docs/RUNTIME_CONTRACTS.md
 * R1–R16 and fails closed if a required 9.4 contract disappeared.
 *
 * Usage: node scripts/runtime-contracts-clone-tag.mjs /tmp/openclaw v2026.9.4
 */
import fs from "node:fs"
import path from "node:path"

const root = process.argv[2]
const tag = process.argv[3] ?? "v2026.9.4"

if (!root || !fs.existsSync(root)) {
  console.error("usage: node scripts/runtime-contracts-clone-tag.mjs <openclaw-clone-dir> [tag]")
  process.exit(2)
}

function read(rel) {
  const p = path.join(root, rel)
  if (!fs.existsSync(p)) return null
  return fs.readFileSync(p, "utf8")
}

function mustContain(rel, needles, label) {
  const body = read(rel)
  if (body === null) {
    throw new Error(`${label}: missing ${rel}`)
  }
  for (const n of needles) {
    if (!body.includes(n)) {
      throw new Error(`${label}: ${rel} missing ${JSON.stringify(n)}`)
    }
  }
}

const failures = []
function check(fn) {
  try {
    fn()
  } catch (err) {
    failures.push(err instanceof Error ? err.message : String(err))
  }
}

check(() => {
  mustContain(
    "src/config/zod-schema.agents.ts",
    ["entries:", 'z.literal("explicit")', "AgentEntryConfigSchema"],
    "R4 AgentsSchema",
  )
  const agents = read("src/config/zod-schema.agents.ts")
  if (agents.includes("list: z.array") && !agents.includes("entries:")) {
    throw new Error("R4: 9.4 clone still has agents.list as the schema and no entries")
  }
})

check(() => {
  mustContain(
    "src/config/zod-schema.agent-defaults.ts",
    ["systemAgent:", "agentId:"],
    "R4 systemAgent",
  )
})

check(() => {
  mustContain(
    "src/config/sessions/startup-migration.ts",
    ["assertSessionStoreMigrationComplete", "SessionStoreMigrationRequiredError"],
    "R8/R9 session store",
  )
})

check(() => {
  const hooks = read("src/plugins/hooks.ts")
  if (!hooks) throw new Error("R6: missing src/plugins/hooks.ts")
  if (!hooks.includes("before_agent_run")) {
    throw new Error("R6: before_agent_run gone")
  }
  if (!hooks.includes("fail-closed") && !hooks.includes("failClosed") && !hooks.includes("fail_closed")) {
    if (!hooks.includes("runModifyingHook")) {
      throw new Error("R6: modifying/fail-closed gate symbols gone")
    }
  }
})

check(() => {
  const pkg = JSON.parse(read("package.json") ?? "{}")
  const croner = pkg.dependencies?.croner ?? pkg.devDependencies?.croner
  if (croner !== "10.0.1" && croner !== "^10.0.1") {
    throw new Error(`R5: croner pin moved (got ${croner})`)
  }
})

check(() => {
  mustContain(
    "extensions/admin-http-rpc/src/methods.ts",
    ['"health"', "cron.run"],
    "R7 admin RPC",
  )
})

check(() => {
  const cfg = read("src/config/io.ts") ?? read("src/config/config.ts") ?? ""
  const all = [
    cfg,
    read("src/commands/doctor.ts") ?? "",
    read("src/config/io.write.ts") ?? "",
  ].join("\n")
  const tree = []
  function walk(dir) {
    let ents
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of ents) {
      const p = path.join(dir, e.name)
      if (e.isDirectory() && e.name !== "node_modules" && e.name !== ".git") walk(p)
      else if (e.isFile() && e.name.endsWith(".ts")) tree.push(p)
    }
  }
  walk(path.join(root, "src"))
  const hit = tree.some((p) => fs.readFileSync(p, "utf8").includes("OPENCLAW_CONFIG_READONLY"))
  if (!hit && !all.includes("OPENCLAW_CONFIG_READONLY")) {
    throw new Error("R4: OPENCLAW_CONFIG_READONLY missing from 9.4 clone")
  }
})

check(() => {
  mustContain(
    "src/agents/sandbox/sanitize-env-vars.ts",
    ["sanitizeEnvVars", "_ADMIN_KEY"],
    "R10 sanitizer",
  )
  if (!fs.existsSync(path.join(root, "src/skills/runtime/env-overrides.ts"))) {
    throw new Error("R10: src/skills/runtime/env-overrides.ts missing (9.4 path)")
  }
})

check(() => {
  mustContain("src/plugin-sdk/plugin-entry.ts", ["definePluginEntry"], "R6 plugin-sdk")
})

check(() => {
  const p = path.join(root, "src/state/openclaw-agent-db.paths.ts")
  const body = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : ""
  if (!body.includes("openclaw-agent.sqlite") && !body.includes(".sqlite")) {
    throw new Error("R8: sqlite session path helper missing")
  }
})

check(() => {
  mustContain(
    "src/cron/store.ts",
    ["resolveDefaultCronStorePath", "jobs.json", "loadCronStore", "saveCronStore"],
    "R16 cron JSON store",
  )
})

if (failures.length > 0) {
  console.error(`clone-tag ${tag} FAILED:`)
  for (const f of failures) console.error(` - ${f}`)
  process.exit(1)
}

console.log(`clone-tag ${tag} OK (${root})`)
