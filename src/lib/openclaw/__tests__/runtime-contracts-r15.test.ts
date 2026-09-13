/**
 * Overlay-side R1–R16 locks for the 9.4 port.
 * Clone-tag symbol greps live in scripts/runtime-contracts-clone-tag.mjs (CI).
 * MUTATION: unconditional agents.list (dropping the 9.4 branch), unconditional
 * agents.entries (dropping the 5.22 branch), and the 100ms before_agent_run
 * timeout all fail. Version-keyed emission is R17.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { z } from "zod"

const ROOT = process.cwd()

function src(rel: string) {
  return readFileSync(resolve(ROOT, rel), "utf8")
}

const AgentsEmitSchema = z
  .object({
    ownership: z.literal("explicit"),
    defaults: z
      .object({
        systemAgent: z.object({ agentId: z.string().min(1) }).strict(),
      })
      .passthrough(),
    entries: z.record(
      z.string().regex(/^[a-z0-9_][a-z0-9_-]{0,63}$/i),
      z
        .object({
          name: z.string(),
          workspace: z.string(),
          model: z.string(),
        })
        .passthrough(),
    ),
  })
  .strict()

describe("RUNTIME_CONTRACTS R1–R16 overlay locks (9.4)", () => {
  it("R1: build workflow does not move :candidate or :latest", () => {
    const yml = src(".github/workflows/build-openclaw-image.yml")
    expect(yml).toContain("STOP_MOVING_CANDIDATE_ASSERT")
    expect(yml).not.toMatch(
      /\$\{\{ env\.REGISTRY \}\}\/\$\{\{ env\.IMAGE_NAME \}\}:candidate\s*$/m,
    )
    expect(yml).not.toMatch(
      /\$\{\{ env\.REGISTRY \}\}\/\$\{\{ env\.IMAGE_NAME \}\}:latest\s*$/m,
    )
  })

  it("R4+R17: agents emission is version-keyed - 9.4 branch emits entries/ownership/systemAgent, 5.22 branch emits list/default:true, neither unconditionally", () => {
    const gen = src("src/lib/openclaw/generator.ts")
    // One regex locks the keying of the agents-config assembly: deleting the
    // else (unconditional 9.4 - the KEEP wake Invalid-config P0) or deleting
    // the if (unconditional 5.22) both fail this match. Output-shape locks
    // live in runtime-contract-emission.test.ts (Zod strict, both contracts).
    expect(gen).toMatch(
      /if \(runtimeContract === '9\.4'\) \{[\s\S]{0,400}?ownership: 'explicit',[\s\S]{0,200}?entries: agentsEntries,[\s\S]{0,200}?\} else \{[\s\S]{0,200}?list: agentsList,/,
    )
    // 9.4 routing fallback (defaults.systemAgent) is assigned, not emitted on 5.22.
    expect(gen).toContain(
      "agentsDefaults.systemAgent = { agentId: orchestratorAgentId }",
    )
    // 5.22 routing fallback: orchestrator list entry carries default: true.
    expect(gen).toMatch(/\{ id: agentId, default: true, \.\.\.entry \}/)
    // The post-hoc roster mutation pattern stays dead on the keyed roster.
    expect(gen).not.toMatch(/entry\.default\s*=\s*true/)
    const sample = {
      ownership: "explicit" as const,
      defaults: { systemAgent: { agentId: "test-commander" } },
      entries: {
        "test-commander": {
          name: "Test Commander",
          workspace: "/home/node/.openclaw/workspace-test-commander",
          model: "anthropic/claude-haiku-4-5-20251001",
        },
      },
    }
    expect(() => AgentsEmitSchema.parse(sample)).not.toThrow()
    expect(() =>
      AgentsEmitSchema.parse({ ...sample, list: [{ id: "x", default: true }] }),
    ).toThrow()
  })

  it("R4: OPENCLAW_CONFIG_READONLY=1 on railway env + generated .env", () => {
    expect(src("src/lib/openclaw/deployer.ts")).toContain("OPENCLAW_CONFIG_READONLY")
    expect(src("src/lib/openclaw/generator.ts")).toContain("OPENCLAW_CONFIG_READONLY=1")
  })

  it("R5: heartbeat catch-up still loads croner from /app", () => {
    const catchup = src("container/heartbeat-catchup.mjs")
    expect(catchup).toContain("croner")
    expect(catchup).toMatch(/createRequire\(["']\/app\/package\.json["']\)/)
  })

  it("R6: before_agent_run returns {outcome:pass} and is not registered with timeoutMs", () => {
    const reporter = src("container/claws-activity-reporter/index.mjs")
    expect(reporter).toContain('return { outcome: "pass" }')
    expect(reporter).toContain('api.on("before_agent_run", handleBeforeAgentRun)')
    expect(reporter).not.toMatch(
      /api\.on\(\s*["']before_agent_run["']\s*,\s*handleBeforeAgentRun\s*,\s*\{\s*timeoutMs/,
    )
  })

  it("R7: catch-up still posts health + cron.run force", () => {
    const catchup = src("container/heartbeat-catchup.mjs")
    expect(catchup).toContain("cron.run")
    expect(catchup).toContain('"force"')
  })

  it("R8: thinking-signature heal covers sqlite + keeps jsonl", () => {
    const heal = src("container/thinking-signature-heal.mjs")
    expect(heal).toContain("openclaw-agent.sqlite")
    expect(heal).toContain("stripThinkingFromSqliteFile")
    expect(heal).toContain("stripThinkingFromSessionJsonl")
  })

  it("R9: state-sync bundles sqlite and will not rebuild sessions.json over a sqlite store", () => {
    const sync = src("container/state-sync.mjs")
    expect(sync).toContain("sqlite-store-present")
    expect(sync).toContain('fileName.endsWith(".sqlite")')
    expect(sync).toContain("sqlitePresent")
    expect(sync).toContain("isJsonlSessionArtifact")
  })

  it("R10: sanitizer vendor is 9.4 (env-overrides path + _ADMIN_KEY + override names)", () => {
    expect(src("src/test/fixtures/openclaw-sanitizer/README.md")).toContain("v2026.9.4")
    expect(src("src/test/fixtures/openclaw-sanitizer/sanitize-env-vars.ts")).toContain(
      "_ADMIN_KEY",
    )
    expect(src("src/test/fixtures/openclaw-sanitizer/skill-env-sanitizer.ts")).toContain(
      "src/skills/runtime/env-overrides.ts",
    )
    expect(src("src/test/fixtures/openclaw-sanitizer/host-env-security.ts")).toContain(
      "isDangerousHostEnvOverrideVarName",
    )
  })

  it("R11: overlay_boot is not heartbeat beat evidence", () => {
    const body = src("src/lib/hibernation/next-heartbeat.ts")
    const fn = body.slice(body.indexOf("export function isHeartbeatBeatEvidence"))
    const end = fn.indexOf("\nexport function", 10)
    const slice = end === -1 ? fn : fn.slice(0, end)
    expect(slice).not.toMatch(/eventKind\s*===\s*["']overlay_boot["']/)
    expect(slice).not.toContain('metadata?.eventKind === "overlay_boot"')
  })

  it("R12–R14: KEEP canary id is documented; volume migration is a non-soak heal; candidate soak never KEEP", () => {
    const contracts = src("docs/RUNTIME_CONTRACTS.md")
    expect(contracts).toContain("cmr3fo19r000404jlze8o7dm8")
    const registry = src("container/heal-registry.mjs")
    expect(registry).toContain("runtime_volume_migration")
    expect(registry).toContain("runtime-volume-migration")
    expect(registry).toMatch(/runtime_volume_migration[\s\S]*soakCounts:\s*false/)
    const soak = src("src/lib/openclaw/candidate-soak.ts")
    expect(soak).toContain("cmr3fo19r000404jlze8o7dm8")
    expect(src("src/lib/openclaw/deployer.ts")).toContain("mayDeployCandidateImage")
  })

  it("R15: gateway spawn + healthz path still present", () => {
    const pm = src("container/process-manager.mjs")
    expect(pm).toContain("openclaw.mjs")
    expect(pm).toContain("gateway")
    expect(pm).toContain("runRuntimeVolumeMigration")
    expect(pm).toMatch(/doctor/)
  })

  it("R16: 9.4 cron canonical store is jobs.json; emit including empty; re-emit after restore", () => {
    const contracts = src("docs/RUNTIME_CONTRACTS.md")
    expect(contracts).toContain("resolveDefaultCronStorePath")
    expect(contracts).toContain("R16")
    expect(contracts).not.toMatch(/R16[\s\S]{0,200}sqlite canonical/)
    const deployer = src("src/lib/openclaw/deployer.ts")
    expect(deployer).toContain("export function buildWorkspaceFileMap")
    expect(deployer).not.toContain("cronContent !== '[]'")
    const cronStore = src("container/cron-store.mjs")
    expect(cronStore).toContain("upsertCronJobsById")
    expect(cronStore).toContain('cron/jobs.json')
    const pm = src("container/process-manager.mjs")
    expect(pm).toContain("reemitCanonicalCronStore")
    expect(pm).toContain("archiveExecApprovalsLegacy")
  })
})
