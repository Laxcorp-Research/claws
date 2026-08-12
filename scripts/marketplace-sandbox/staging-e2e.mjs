#!/usr/bin/env node
/**
 * Staging E2E: insert fixtures via pg, grade+POST via run.mjs, print reports.
 */
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { createHash, randomBytes } from "node:crypto"
import { spawnSync } from "node:child_process"
import pg from "pg"

const __dirname = dirname(fileURLToPath(import.meta.url))

async function main() {
  const databaseUrl = process.env.DATABASE_URL
  const token = process.env.SANDBOX_REPORT_TOKEN
  if (!databaseUrl || !token) {
    console.error("DATABASE_URL and SANDBOX_REPORT_TOKEN required")
    process.exit(1)
  }
  const intake = (process.env.SANDBOX_INTAKE_BASE_URL || "https://staging.app.buildclaws.ai").replace(
    /\/$/,
    "",
  )

  const pool = new pg.Pool({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } })

  const fixtures = [
    {
      key: "benign",
      name: "Sandbox E2E Benign",
      slug: `sandbox-e2e-benign-${Date.now().toString(36)}`,
      skillMd: readFileSync(join(__dirname, "fixtures/benign-skill.md"), "utf8"),
    },
    {
      key: "malicious",
      name: "Sandbox E2E Malicious",
      slug: `sandbox-e2e-malicious-${Date.now().toString(36)}`,
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
      [
        id,
        f.slug,
        f.name,
        `E2E sandbox fixture (${f.key})`,
        "utilities",
        ["sandbox-e2e"],
        f.skillMd,
        [],
        [],
      ],
    )
    console.log(`created ${f.key} skillId=${id} digest=${digest.slice(0, 12)}`)

    const env = {
      ...process.env,
      SANDBOX_SKILL_ID: id,
      SANDBOX_CONTENT_DIGEST: digest,
      SANDBOX_INTAKE_BASE_URL: intake,
      SANDBOX_REPORT_TOKEN: token,
      SANDBOX_DOCKER_IMAGE: "e2e-local-grade",
      SANDBOX_OUT_DIR: join(__dirname, `.out-${f.key}`),
      SANDBOX_SKIP_AGENT: process.env.SANDBOX_ANTHROPIC_KEY ? "0" : "1",
    }
    const r = spawnSync(process.execPath, [join(__dirname, "run.mjs")], {
      env,
      encoding: "utf8",
    })
    process.stdout.write(r.stdout || "")
    if (r.status !== 0) {
      console.error(r.stderr || "")
      console.error(`run.mjs failed for ${f.key} status=${r.status}`)
    }

    const { rows } = await pool.query(
      `SELECT "sandboxPassed", "sandboxReport" FROM "MarketplaceSkill" WHERE id = $1`,
      [id],
    )
    results[f.key] = {
      skillId: id,
      digest,
      sandboxPassed: rows[0]?.sandboxPassed,
      sandboxReport: rows[0]?.sandboxReport,
    }
  }

  console.log("\n=== SANDBOX E2E REPORTS ===\n")
  for (const key of ["benign", "malicious"]) {
    console.log(`--- ${key} passed=${results[key].sandboxPassed} skillId=${results[key].skillId} ---`)
    console.log(results[key].sandboxReport || "(no report)")
    console.log("")
  }

  await pool.end()

  const benignOk = results.benign.sandboxPassed === true
  const mal = results.malicious.sandboxReport || ""
  const malOk =
    results.malicious.sandboxPassed === false &&
    mal.includes("EGRESS_ATTEMPT") &&
    mal.includes("CRED_PATH_TOUCH")
  if (!benignOk || !malOk) {
    console.error("E2E assertions failed", { benignOk, malOk })
    process.exit(1)
  }
  console.log("E2E OK")
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
