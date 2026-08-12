import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { computeSkillContentDigest } from "@/lib/marketplace/sandbox-digest"
import { reportMatchesDigest } from "@/lib/marketplace/sandbox-grade"

const WORKFLOW_ID = "marketplace-skill-sandbox.yml"
const DEFAULT_REPO = "Laxcorp-Research/claws"

export type SandboxEnqueueResult =
  | { status: "reused"; contentDigest: string }
  | { status: "dispatched"; contentDigest: string; runId?: number }
  | { status: "skipped"; reason: string; contentDigest: string }

/**
 * Idempotent enqueue: same (skillId, contentDigest) reuses existing report.
 * Dispatches GH Actions workflow_dispatch when a new digest needs vetting.
 */
export async function enqueueSkillSandbox(skillId: string): Promise<SandboxEnqueueResult> {
  const skill = await prisma.marketplaceSkill.findUnique({
    where: { id: skillId },
    select: {
      id: true,
      skillMd: true,
      requiredBins: true,
      requiredEnvVars: true,
      sandboxPassed: true,
      sandboxReport: true,
    },
  })
  if (!skill) {
    return { status: "skipped", reason: "skill_not_found", contentDigest: "" }
  }

  const contentDigest = computeSkillContentDigest({
    skillMd: skill.skillMd,
    requiredBins: skill.requiredBins,
    requiredEnvVars: skill.requiredEnvVars,
  })

  if (
    skill.sandboxReport &&
    reportMatchesDigest(skill.sandboxReport, contentDigest) &&
    skill.sandboxPassed !== null
  ) {
    log.info("Sandbox report reused (idempotent digest hit)", {
      category: "marketplace",
      skillId,
      contentDigest,
    })
    return { status: "reused", contentDigest }
  }

  const token = process.env.SANDBOX_GITHUB_DISPATCH_TOKEN?.trim()
  const repo = (process.env.SANDBOX_GITHUB_REPO || DEFAULT_REPO).trim()
  const intakeBase =
    process.env.SANDBOX_INTAKE_BASE_URL?.trim() ||
    process.env.NEXTAUTH_URL?.trim() ||
    "https://staging.app.buildclaws.ai"

  if (!token) {
    log.warn("SANDBOX_GITHUB_DISPATCH_TOKEN unset; sandbox not dispatched", {
      category: "marketplace",
      skillId,
    })
    return { status: "skipped", reason: "dispatch_token_unconfigured", contentDigest }
  }

  const dockerImage = await resolveSandboxDockerImage()

  const url = `https://api.github.com/repos/${repo}/actions/workflows/${WORKFLOW_ID}/dispatches`
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ref: process.env.SANDBOX_GITHUB_REF?.trim() || "staging",
      inputs: {
        skill_id: skillId,
        content_digest: contentDigest,
        docker_image: dockerImage,
        intake_base_url: intakeBase.replace(/\/$/, ""),
      },
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => "")
    log.error("Sandbox workflow_dispatch failed", {
      category: "marketplace",
      skillId,
      status: res.status,
      body: body.slice(0, 500),
    })
    return { status: "skipped", reason: `dispatch_http_${res.status}`, contentDigest }
  }

  log.info("Sandbox workflow dispatched", {
    category: "marketplace",
    skillId,
    contentDigest,
    dockerImage,
  })
  return { status: "dispatched", contentDigest }
}

async function resolveSandboxDockerImage(): Promise<string> {
  const stable = await prisma.openClawVersion.findFirst({
    where: { isStable: true },
    select: { dockerImage: true },
    orderBy: { stableAt: "desc" },
  })
  if (stable?.dockerImage && !stable.dockerImage.endsWith(":latest")) {
    return stable.dockerImage
  }
  return (
    process.env.OPENCLAW_DOCKER_IMAGE?.trim() ||
    "ghcr.io/laxcorp-research/openclaw-runtime:2026.5.22-4"
  )
}
