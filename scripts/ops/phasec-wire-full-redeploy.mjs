/**
 * Phase C (WIRE-FULL): redeploy staging fixture via deployer with control-plane secrets.
 * Invoked by .github/workflows/ops-phasec-wire-full-redeploy.yml
 *
 * Fixture: Twitter growth workspace (orch + 4 workers + critic allowAgents).
 */
import { AsyncLocalStorage } from "node:async_hooks"
import { writeFileSync } from "node:fs"

globalThis.AsyncLocalStorage = AsyncLocalStorage

const WS = "cmr3fo19r000404jlze8o7dm8"

function requireEnv(name) {
  const v = process.env[name]?.trim()
  if (!v) throw new Error(`Missing required env: ${name}`)
  if (/^placeholder-/.test(v)) {
    throw new Error(`${name} is still a placeholder-* stub`)
  }
  return v
}

// Staging control plane + Railway (never prod project).
process.env.CLAWS_ENV = "staging"
process.env.NEXT_PUBLIC_APP_URL = "https://staging.app.buildclaws.ai"
process.env.NEXTAUTH_URL = "https://staging.app.buildclaws.ai"
process.env.ACTIVITY_ENDPOINT =
  "https://staging.app.buildclaws.ai/api/internal/activity"
process.env.METERING_ENDPOINT =
  "https://staging.app.buildclaws.ai/api/internal/metering"
process.env.RAILWAY_PROJECT_ID = "00000000-0000-4000-8000-000000000004"
process.env.RAILWAY_ENVIRONMENT_ID = "00000000-0000-4000-8000-000000000002"
process.env.RAILWAY_API_TOKEN = requireEnv("RAILWAY_STAGING_TOKEN")

requireEnv("DATABASE_URL")
requireEnv("METERING_MASTER_SECRET")
requireEnv("ACTIVITY_PIPELINE_SECRET")
requireEnv("ENCRYPTION_MASTER_KEY")

if (process.env.RAILWAY_PROJECT_ID === "00000000-0000-4000-8000-000000000003") {
  throw new Error("Refusing Phase C against production Railway project")
}

console.log("Railway target", {
  project: process.env.RAILWAY_PROJECT_ID,
  env: process.env.RAILWAY_ENVIRONMENT_ID,
})

const { generateWorkspace } = await import("../../src/lib/openclaw/generator.ts")
const { redeployWorkspace } = await import("../../src/lib/openclaw/deployer.ts")

console.log("Generating workspace files…")
const generated = await generateWorkspace(WS)
const configJson = JSON.parse(generated["openclaw.json"])
const orch =
  configJson.agents?.list?.find((a) => a.default === true) ??
  configJson.agents?.list?.[0]
const allowAgents = orch?.subagents?.allowAgents ?? null

const orchKey = Object.keys(generated.workspaces).find(
  (k) => k.includes("twitter-commander") || k.includes("commander"),
)
const agentsMd = orchKey ? generated.workspaces[orchKey]["AGENTS.md"] : ""
const begin = agentsMd.indexOf("<!-- claws:workflow:begin -->")
const end = agentsMd.indexOf("<!-- claws:workflow:end -->")
const fenceBody =
  begin !== -1 && end !== -1
    ? agentsMd.slice(begin, end + "<!-- claws:workflow:end -->".length)
    : ""

const preflight = {
  allowAgents,
  fencePresent: begin !== -1 && end !== -1,
  manualPosture: agentsMd.includes("MANUAL-BY-DESIGN"),
  workflowFenceCorrected: generated.workflowFenceCorrected === true,
  fenceBody,
}
console.log("PREFLIGHT", JSON.stringify({ ...preflight, fenceBody: `[${fenceBody.length} chars]` }))

if (process.argv.includes("--generate-only")) {
  writeFileSync("phasec-receipts.json", JSON.stringify(preflight, null, 2))
  process.exit(0)
}

console.log("Redeploying…")
const result = await redeployWorkspace(WS)
console.log("REDEPLOY", {
  deploymentId: result.deploymentId,
  containerId: result.containerId,
})

const receipts = {
  tipSha: process.env.GITHUB_SHA || null,
  workspaceId: WS,
  preflight,
  redeploy: {
    deploymentId: result.deploymentId,
    containerId: result.containerId,
  },
}
writeFileSync("phasec-receipts.json", JSON.stringify(receipts, null, 2))
console.log("Wrote phasec-receipts.json")
