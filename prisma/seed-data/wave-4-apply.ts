import { parseHeartbeatWindowScripts } from "../../src/lib/openclaw/heartbeat-md-cron"
import type { SeedSharedFile, SeedTemplate } from "./types"

/** Append WAVE-4 window steps onto INFRA-4 HEARTBEAT.md. Never replace it. */
export function mergeHeartbeatOverlay(base: string, overlay: string): string {
  const extras = parseHeartbeatWindowScripts(overlay)
  let out = base
  for (const extra of extras) {
    const heading = `## window ${extra.cron}`
    const start = out.indexOf(heading)
    if (start < 0) continue
    const afterHeading = start + heading.length
    const nextWindow = out.indexOf("\n## window ", afterHeading)
    const sectionEnd = nextWindow >= 0 ? nextWindow : out.length
    const section = out.slice(start, sectionEnd)
    const delivMatch = section.match(/\nDeliverable:\s+.+$/m)
    if (!delivMatch || delivMatch.index == null) continue
    const existingSteps = parseHeartbeatWindowScripts(section)[0]?.steps ?? []
    const toAdd = extra.steps.filter((step) => {
      if (/^Wake\./i.test(step)) return false
      if (/^Write /i.test(step)) return false
      return !existingSteps.includes(step)
    })
    if (toAdd.length === 0) continue
    const startNum = existingSteps.length + 1
    const block = toAdd.map((s, i) => `${startNum + i}. ${s}`).join("\n")
    const insertAt = start + delivMatch.index
    out = `${out.slice(0, insertAt)}\n${block}${out.slice(insertAt)}`
  }
  return out
}

export type Wave4AgentAddendum = {
  soulMd: string
}

export function wave4NamedFile(args: {
  path: string
  title: string
  maintainedBy: string
  schema: string[]
  format: string
  example: string
  entries: string
}): SeedSharedFile {
  return {
    path: args.path,
    content: `# ${args.title}

Maintained by ${args.maintainedBy}. Other agents read this file; only the maintainer writes it.

## Schema
${args.schema.map((line) => `- ${line}`).join("\n")}

## Format
${args.format}

## Example
${args.example}

## Entries
${args.entries}
`,
  }
}

export function applyWave4Overlay(args: {
  template: SeedTemplate
  slug: string
  addenda: Record<string, Wave4AgentAddendum>
  heartbeatMd: string
  files: SeedSharedFile[]
  dropPaths: string[]
}): SeedTemplate {
  if (args.template.slug !== args.slug) return args.template

  const files = [...(args.template.files ?? [])].filter(
    (f) => !args.dropPaths.includes(f.path),
  )
  files.push(...args.files)

  return {
    ...args.template,
    agents: args.template.agents.map((agent) => {
      const add = args.addenda[agent.agentSlug]
      if (!add) {
        throw new Error(`WAVE-4 ${args.slug}: missing prose for ${agent.agentSlug}`)
      }
      return {
        ...agent,
        soulMd: `${agent.soulMd}\n\n${add.soulMd}`,
        heartbeatMd:
          agent.role === "ORCHESTRATOR"
            ? mergeHeartbeatOverlay(agent.heartbeatMd, args.heartbeatMd)
            : agent.heartbeatMd,
        qualityThreshold:
          agent.role === "CRITIC"
            ? (agent.qualityThreshold ?? 8)
            : agent.qualityThreshold,
      }
    }),
    files,
  }
}
