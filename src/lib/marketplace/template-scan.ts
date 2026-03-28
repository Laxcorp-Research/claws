export interface ScanFinding {
  severity: "warning" | "info"
  pattern: string
  location: string
  description: string
}

export interface TemplateScanResult {
  passed: boolean
  findings: ScanFinding[]
  hasWarnings: boolean
}

const TEMPLATE_WARNING_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /ignore (previous|all|your) instructions/i, description: "Potential prompt injection: instruction override" },
  { pattern: /you are now/i, description: "Potential identity hijacking" },
  { pattern: /system override/i, description: "Potential system override command" },
  { pattern: /forget everything/i, description: "Potential memory wipe instruction" },
  { pattern: /send.*to.*https?:\/\//i, description: "References external URL for data sending" },
  { pattern: /upload.*to/i, description: "Contains upload instructions" },
  { pattern: /curl.*\$\{?[A-Z_]*KEY/i, description: "Potential API key exfiltration via curl" },
  { pattern: /rm\s+-rf/i, description: "Destructive recursive delete command" },
  { pattern: /format.*disk/i, description: "Disk formatting reference" },
  { pattern: /shutdown|reboot/i, description: "System shutdown/reboot command" },
]

export function scanTemplate(agents: Array<{
  name: string
  soulMd: string
  agentsMd: string
}>): TemplateScanResult {
  const findings: ScanFinding[] = []

  for (const agent of agents) {
    const soulLines = agent.soulMd.split("\n")
    for (let i = 0; i < soulLines.length; i++) {
      for (const { pattern, description } of TEMPLATE_WARNING_PATTERNS) {
        if (pattern.test(soulLines[i])) {
          findings.push({
            severity: "warning",
            pattern: pattern.source,
            location: `Agent "${agent.name}" SOUL.md line ${i + 1}`,
            description,
          })
        }
      }
    }

    const agentsLines = agent.agentsMd.split("\n")
    for (let i = 0; i < agentsLines.length; i++) {
      for (const { pattern, description } of TEMPLATE_WARNING_PATTERNS) {
        if (pattern.test(agentsLines[i])) {
          findings.push({
            severity: "warning",
            pattern: pattern.source,
            location: `Agent "${agent.name}" AGENTS.md line ${i + 1}`,
            description,
          })
        }
      }
    }
  }

  return {
    passed: true,
    findings,
    hasWarnings: findings.length > 0,
  }
}
