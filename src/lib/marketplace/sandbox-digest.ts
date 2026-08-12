import { createHash } from "node:crypto"

/** Stable content digest for sandbox idempotency (skillId, contentDigest). */
export function computeSkillContentDigest(input: {
  skillMd: string
  requiredBins: string[]
  requiredEnvVars: string[]
}): string {
  const bins = [...input.requiredBins].map((b) => b.trim()).filter(Boolean).sort()
  const envs = [...input.requiredEnvVars].map((e) => e.trim()).filter(Boolean).sort()
  const payload = JSON.stringify({
    skillMd: input.skillMd.replace(/\r\n/g, "\n"),
    requiredBins: bins,
    requiredEnvVars: envs,
  })
  return createHash("sha256").update(payload, "utf8").digest("hex")
}
