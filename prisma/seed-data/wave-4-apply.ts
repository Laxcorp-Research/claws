import type { SeedSharedFile, SeedTemplate } from "./types"

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
          agent.role === "ORCHESTRATOR" ? args.heartbeatMd : agent.heartbeatMd,
        qualityThreshold:
          agent.role === "CRITIC"
            ? (agent.qualityThreshold ?? 8)
            : agent.qualityThreshold,
      }
    }),
    files,
  }
}
