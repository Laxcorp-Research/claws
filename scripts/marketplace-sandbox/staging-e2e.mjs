#!/usr/bin/env node
/**
 * Staging E2E: insert benign + malicious fixture skills, force enqueue (or
 * grade+POST locally if dispatch unavailable), print both sandboxReports.
 *
 * Env:
 *   DATABASE_URL (staging)
 *   SANDBOX_REPORT_TOKEN
 *   SANDBOX_INTAKE_BASE_URL (default staging)
 *   SANDBOX_GITHUB_DISPATCH_TOKEN (optional — dispatch real GHA)
 *   SANDBOX_E2E_LOCAL_GRADE=1 — grade+POST without waiting on GHA (still hits intake)
 */
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"

const __dirname = dirname(fileURLToPath(import.meta.url))

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL required")
    process.exit(1)
  }

  const { PrismaClient } = await import("../../src/generated/prisma/client.ts").catch(() =>
    import("../../src/generated/prisma/client.js"),
  ).catch(async () => {
    const m = await import("@prisma/client")
    return m
  })

  // Prefer generated client with adapter if present — fall back to simple PrismaClient
  let prisma
  try {
    const { PrismaPg } = await import("@prisma/adapter-pg")
    const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
    prisma = new PrismaClient({ adapter })
  } catch {
    prisma = new PrismaClient()
  }

  const intake = (process.env.SANDBOX_INTAKE_BASE_URL || "https://staging.app.buildclaws.ai").replace(/\/$/, "")
  const token = process.env.SANDBOX_REPORT_TOKEN
  if (!token) {
    console.error("SANDBOX_REPORT_TOKEN required")
    process.exit(1)
  }

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
      .update(JSON.stringify({
        skillMd: f.skillMd.replace(/\r\n/g, "\n"),
        requiredBins: [],
        requiredEnvVars: [],
      }), "utf8")
      .digest("hex")

    const skill = await prisma.marketplaceSkill.create({
      data: {
        slug: f.slug,
        name: f.name,
        description: `E2E sandbox fixture (${f.key})`,
        category: "utilities",
        tags: ["sandbox-e2e"],
        skillMd: f.skillMd,
        requiredBins: [],
        requiredEnvVars: [],
        trustTier: "UNREVIEWED",
        reviewStatus: "PENDING",
        isPublished: false,
        isFree: true,
        autoScanPassed: true,
        sandboxPassed: null,
        sandboxReport: null,
      },
    })
    console.log(`created ${f.key} skillId=${skill.id} digest=${digest.slice(0, 12)}`)

    if (process.env.SANDBOX_E2E_LOCAL_GRADE === "1") {
      // Import grade via dynamic path using the same logic as run.mjs by spawning it
      const { spawnSync } = await import("node:child_process")
      const env = {
        ...process.env,
        SANDBOX_SKILL_ID: skill.id,
        SANDBOX_CONTENT_DIGEST: digest,
        SANDBOX_INTAKE_BASE_URL: intake,
        SANDBOX_REPORT_TOKEN: token,
        SANDBOX_DOCKER_IMAGE: "e2e-local",
        SANDBOX_OUT_DIR: join(__dirname, `.out-${f.key}`),
      }
      // Skip agent if no key — still grades skill_md (enough for malicious proof)
      if (!env.SANDBOX_ANTHROPIC_KEY) env.SANDBOX_ANTHROPIC_KEY = "sk-ant-missing"
      const r = spawnSync(process.execPath, [join(__dirname, "run.mjs")], { env, encoding: "utf8" })
      console.log(r.stdout)
      if (r.stderr) console.error(r.stderr)
    } else {
      // Dispatch via app enqueue would need the Next server; call GHA API directly.
      const ghToken = process.env.SANDBOX_GITHUB_DISPATCH_TOKEN
      if (!ghToken) {
        console.error("Set SANDBOX_GITHUB_DISPATCH_TOKEN or SANDBOX_E2E_LOCAL_GRADE=1")
        process.exit(1)
      }
      const dockerImage =
        (await prisma.openClawVersion.findFirst({
          where: { isStable: true },
          select: { dockerImage: true },
        }))?.dockerImage || "ghcr.io/laxcorp-research/openclaw-runtime:2026.5.22-4"

      const res = await fetch(
        "https://api.github.com/repos/Laxcorp-Research/claws/actions/workflows/marketplace-skill-sandbox.yml/dispatches",
        {
          method: "POST",
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${ghToken}`,
            "X-GitHub-Api-Version": "2022-11-28",
          },
          body: JSON.stringify({
            ref: process.env.SANDBOX_GITHUB_REF || "staging",
            inputs: {
              skill_id: skill.id,
              content_digest: digest,
              docker_image: dockerImage,
              intake_base_url: intake,
            },
          }),
        },
      )
      console.log(`dispatch ${f.key}: ${res.status}`)
    }

    results[f.key] = { skillId: skill.id, digest }
  }

  if (process.env.SANDBOX_E2E_LOCAL_GRADE !== "1") {
    console.log("Waiting up to 12m for reports...")
    const deadline = Date.now() + 12 * 60_000
    while (Date.now() < deadline) {
      let done = true
      for (const key of Object.keys(results)) {
        const row = await prisma.marketplaceSkill.findUnique({
          where: { id: results[key].skillId },
          select: { sandboxPassed: true, sandboxReport: true },
        })
        results[key].sandboxPassed = row?.sandboxPassed
        results[key].sandboxReport = row?.sandboxReport
        if (row?.sandboxPassed === null || !row?.sandboxReport) done = false
      }
      if (done) break
      await new Promise((r) => setTimeout(r, 15_000))
    }
  } else {
    for (const key of Object.keys(results)) {
      const row = await prisma.marketplaceSkill.findUnique({
        where: { id: results[key].skillId },
        select: { sandboxPassed: true, sandboxReport: true },
      })
      results[key].sandboxPassed = row?.sandboxPassed
      results[key].sandboxReport = row?.sandboxReport
    }
  }

  console.log("\n=== SANDBOX E2E REPORTS ===\n")
  for (const key of ["benign", "malicious"]) {
    console.log(`--- ${key} passed=${results[key].sandboxPassed} ---`)
    console.log(results[key].sandboxReport || "(no report)")
    console.log("")
  }

  await prisma.$disconnect()

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
