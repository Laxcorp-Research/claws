/**
 * Boot payload for a real OpenClaw image on the local Docker provider.
 * The fixture gateway image keeps its own CMD and does not get this payload.
 */
import { gzipSync } from "node:zlib"
import { BOOT_SCRIPT_B64, START_COMMAND } from "@/lib/openclaw/railway-client"
import type { GeneratedWorkspace } from "@/lib/openclaw/generator"

const BOOT_INNER =
  "echo $CLAWS_BOOT_B64 | base64 -d > /tmp/boot.sh && exec sh /tmp/boot.sh"

export function isFixtureGatewayImage(image: string): boolean {
  return image.includes("fixture-gateway")
}

/** Docker Cmd form of Railway START_COMMAND. The fixture image must not use this. */
export function dockerRuntimeCommand(): string[] {
  return ["/bin/sh", "-c", BOOT_INNER]
}

export function dockerRuntimeCommandMatchesRailway(): boolean {
  return START_COMMAND.includes(BOOT_INNER)
}

function gzipBase64(content: string): string {
  return gzipSync(Buffer.from(content, "utf8")).toString("base64")
}

/** Same map Railway puts in CLAWS_FILES_GZ_B64. Kept in lockstep by a unit test. */
export function workspaceFilesForBoot(
  generated: Pick<GeneratedWorkspace, "workspaces" | "cron/jobs.json">,
): Record<string, string> {
  const files: Record<string, string> = {}
  const cronContent = generated["cron/jobs.json"]
  if (typeof cronContent === "string") {
    files["cron/jobs.json"] = cronContent
  }
  for (const [dirName, agentFiles] of Object.entries(generated.workspaces)) {
    for (const [fileName, content] of Object.entries(agentFiles)) {
      if (fileName === "skills" && typeof content === "object" && content !== null) {
        for (const [skillName, skillFiles] of Object.entries(
          content as Record<string, Record<string, string>>,
        )) {
          for (const [skillFile, skillContent] of Object.entries(skillFiles)) {
            files[`${dirName}/skills/${skillName}/${skillFile}`] = skillContent
          }
        }
      } else if (typeof content === "string") {
        files[`${dirName}/${fileName}`] = content
      }
    }
  }
  return files
}

const SKIP_FROM_DOTENV = new Set([
  "OPENCLAW_GATEWAY_TOKEN",
  "PORT",
  "CLAWS_BOOT_B64",
  "CLAWS_CONFIG_GZ_B64",
  "CLAWS_ENV_GZ_B64",
  "CLAWS_FILES_GZ_B64",
  "CLAWS_SEED_FILES_GZ_B64",
])

/**
 * Env for a real runtime container. Includes the gzipped generator output
 * the boot script unpacks, and copies provider keys from the generated .env
 * into process env so the gateway sees them without a dotenv loader.
 */
export function runtimeLaunchEnv(args: {
  generated: {
    "openclaw.json": string
    ".env": string
    runtimeContract?: string
    seedFiles?: Record<string, string>
  }
  files: Record<string, string>
  gatewayToken: string
}): string[] {
  const lines = [
    `CLAWS_BOOT_B64=${BOOT_SCRIPT_B64}`,
    `CLAWS_CONFIG_GZ_B64=${gzipBase64(args.generated["openclaw.json"])}`,
    `CLAWS_ENV_GZ_B64=${gzipBase64(args.generated[".env"])}`,
    `CLAWS_FILES_GZ_B64=${gzipBase64(JSON.stringify(args.files))}`,
    `OPENCLAW_GATEWAY_TOKEN=${args.gatewayToken}`,
    "PORT=18789",
  ]
  if (args.generated.runtimeContract === "9.4") {
    lines.push("OPENCLAW_CONFIG_READONLY=1")
  }
  const seeds = args.generated.seedFiles
  if (seeds && Object.keys(seeds).length > 0) {
    lines.push(`CLAWS_SEED_FILES_GZ_B64=${gzipBase64(JSON.stringify(seeds))}`)
  }
  for (const raw of args.generated[".env"].split("\n")) {
    const line = raw.trim()
    if (!line || line.startsWith("#")) continue
    const eq = line.indexOf("=")
    if (eq <= 0) continue
    const key = line.slice(0, eq)
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) continue
    if (SKIP_FROM_DOTENV.has(key)) continue
    lines.push(line)
  }
  return lines
}
