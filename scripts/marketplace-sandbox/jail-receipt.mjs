#!/usr/bin/env node
/**
 * JAIL RECEIPT: create fixtures on staging DB, workflow_dispatch real GHA,
 * wait for intake reports, print receipts. Never logs secret values.
 *
 * Env: DATABASE_URL, SANDBOX_REPORT_TOKEN, SANDBOX_GITHUB_DISPATCH_TOKEN
 * Optional: SANDBOX_INTAKE_BASE_URL, SANDBOX_DOCKER_IMAGE, SANDBOX_GITHUB_REF
 */
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { createHash, randomBytes } from "node:crypto"
import pg from "pg"

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO = process.env.SANDBOX_GITHUB_REPO || "Laxcorp-Research/claws"
const REF = process.env.SANDBOX_GITHUB_REF || "staging"
const INTAKE = (process.env.SANDBOX_INTAKE_BASE_URL || "https://staging.app.buildclaws.ai").replace(
  /\/$/,
  "",
)

async function main() {
  const databaseUrl = process.env.DATABASE_URL
  const reportToken = process.env.SANDBOX_REPORT_TOKEN
  const dispatchToken = process.env.SANDBOX_GITHUB_DISPATCH_TOKEN
  if (!databaseUrl || !reportToken || !dispatchToken) {
    console.error("DATABASE_URL, SANDBOX_REPORT_TOKEN, SANDBOX_GITHUB_DISPATCH_TOKEN required")
    process.exit(1)
  }

  const pool = new pg.Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } })

  let dockerImage = process.env.SANDBOX_DOCKER_IMAGE
  if (!dockerImage) {
    const { rows } = await pool.query(
      `SELECT "dockerImage" FROM "OpenClawVersion" WHERE "isStable" = true ORDER BY "stableAt" DESC NULLS LAST LIMIT 1`,
    )
    dockerImage = rows[0]?.dockerImage
  }
  if (!dockerImage || dockerImage.endsWith(":latest")) {
    dockerImage = "ghcr.io/laxcorp-research/openclaw-runtime:2026.5.22-4"
  }
  console.log(`dockerImage=${dockerImage}`)

  const fixtures = [
    {
      key: "benign",
      name: "Jail Receipt Benign",
      slug: `jail-benign-${Date.now().toString(36)}`,
      skillMd: readFileSync(join(__dirname, "fixtures/benign-skill.md"), "utf8"),
    },
    {
      key: "malicious",
      name: "Jail Receipt Malicious",
      slug: `jail-malicious-${Date.now().toString(36)}`,
      skillMd: readFileSync(join(__dirname, "fixtures/malicious-skill.md"), "utf8"),
    },
  ]

  const results = {}

  for (const f of fixtures) {
    const digest = createHash("sha256")
      .update(
        JSON.stringify({
          skillMd: f.skillMd.replace(/\r\n/g, "\n"),
          requiredBins: [],
          requiredEnvVars: [],
        }),
        "utf8",
      )
      .digest("hex")
    const id = `c${randomBytes(12).toString("hex")}`
    await pool.query(
      `INSERT INTO "MarketplaceSkill" (
        id, slug, name, description, category, tags, "skillMd",
        "requiredBins", "requiredEnvVars", "trustTier", "reviewStatus",
        "isPublished", "isFree", "autoScanPassed", "sandboxPassed", "sandboxReport",
        "installCount", version, "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7,
        $8, $9, 'UNREVIEWED', 'PENDING',
        false, true, true, NULL, NULL,
        0, 1, NOW(), NOW()
      )`,
      [id, f.slug, f.name, `Jail receipt (${f.key})`, "utilities", ["jail-receipt"], f.skillMd, [], []],
    )

    const disp = await fetch(
      `https://api.github.com/repos/${REPO}/actions/workflows/marketplace-skill-sandbox.yml/dispatches`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${dispatchToken}`,
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ref: REF,
          inputs: {
            skill_id: id,
            content_digest: digest,
            docker_image: dockerImage,
            intake_base_url: INTAKE,
          },
        }),
      },
    )
    if (!disp.ok) {
      const body = await disp.text()
      console.error(`DISPATCH_FAIL ${f.key} status=${disp.status}`)
      console.error(body.slice(0, 2000))
      await pool.end()
      process.exit(1)
    }
    console.log(`dispatched ${f.key} skillId=${id}`)
    results[f.key] = { skillId: id, digest, dockerImage }
    // concurrency 1 — wait for this report before next dispatch
    const deadline = Date.now() + 14 * 60_000
    while (Date.now() < deadline) {
      const { rows } = await pool.query(
        `SELECT "sandboxPassed", "sandboxReport" FROM "MarketplaceSkill" WHERE id = $1`,
        [id],
      )
      if (rows[0]?.sandboxReport) {
        results[f.key].sandboxPassed = rows[0].sandboxPassed
        results[f.key].sandboxReport = rows[0].sandboxReport
        break
      }
      await new Promise((r) => setTimeout(r, 20_000))
    }
    if (!results[f.key].sandboxReport) {
      console.error(`TIMEOUT waiting for report ${f.key}`)
      await pool.end()
      process.exit(1)
    }
  }

  // Resolve GHA run URLs
  const runsRes = await fetch(
    `https://api.github.com/repos/${REPO}/actions/workflows/marketplace-skill-sandbox.yml/runs?per_page=5&branch=${encodeURIComponent(REF)}`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${dispatchToken}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  )
  const runsJson = await runsRes.json()
  const runUrls = (runsJson.workflow_runs || []).slice(0, 4).map((r) => ({
    id: r.id,
    url: r.html_url,
    status: r.status,
    conclusion: r.conclusion,
    created_at: r.created_at,
  }))

  console.log("\n=== JAIL RECEIPTS ===\n")
  console.log("GHA runs:", JSON.stringify(runUrls, null, 2))
  for (const key of ["benign", "malicious"]) {
    const rep = JSON.parse(results[key].sandboxReport)
    console.log(`\n--- ${key} passed=${results[key].sandboxPassed} skillId=${results[key].skillId} ---`)
    console.log(`dockerImage=${rep.dockerImage}`)
    console.log(`execution=${rep.execution}`)
    console.log(`agentTurn=${JSON.stringify(rep.agentTurn)}`)
    const execViolations = (rep.violations || []).filter((v) => v.source !== "skill_md")
    console.log(`non_skill_md_violations=${JSON.stringify(execViolations)}`)
    console.log(`all_violations=${JSON.stringify(rep.violations)}`)
    console.log(`FULL_REPORT=${results[key].sandboxReport}`)
  }

  await pool.end()

  const benign = JSON.parse(results.benign.sandboxReport)
  const mal = JSON.parse(results.malicious.sandboxReport)
  const benignOk =
    results.benign.sandboxPassed === true &&
    benign.execution === "jail" &&
    benign.agentTurn?.completed === true &&
    (benign.agentTurn?.summary || "") !== "AGENT_SKIPPED"
  const malOk =
    results.malicious.sandboxPassed === false &&
    mal.violations.some((v) => v.class === "EGRESS_ATTEMPT") &&
    mal.violations.some((v) => v.class === "CRED_PATH_TOUCH")

  if (!benignOk || !malOk) {
    console.error("JAIL assertions failed", { benignOk, malOk })
    process.exit(1)
  }
  console.log("\nJAIL RECEIPT OK")
  // Print skill ids for approve step
  console.log(`BENIGN_SKILL_ID=${results.benign.skillId}`)
  console.log(`MALICIOUS_SKILL_ID=${results.malicious.skillId}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
