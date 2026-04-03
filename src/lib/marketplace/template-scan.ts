export interface TemplateScanFinding {
  severity: "critical" | "warning"
  pattern: string
  agentName: string
  file: string
  line: number
  description: string
  matchedText: string
}

export interface TemplateScanResult {
  passed: boolean
  findings: TemplateScanFinding[]
  scannedAgents: number
  hasCritical: boolean
  hasWarnings: boolean
  criticalCount: number
  warningCount: number
}

const CRITICAL_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /curl.*\$\{?[A-Z_]*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i, description: "Credential exfiltration via curl" },
  { pattern: /wget.*\$\{?[A-Z_]*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i, description: "Credential exfiltration via wget" },
  { pattern: /send.*(key|token|secret|password|credential).*to/i, description: "Instructions to send credentials externally" },
  { pattern: /base64\s+(encode|decode)/i, description: "Base64 obfuscation" },
  { pattern: /eval\s*\(/, description: "Code execution via eval" },
  { pattern: /\$\(.*\$\{/, description: "Nested command substitution with variables" },
  { pattern: /\/etc\/(shadow|passwd|hosts)/i, description: "System file access" },
  { pattern: /\/root\//, description: "Root directory access" },
  { pattern: /~\/.ssh/, description: "SSH key access" },
  { pattern: /\.env(?!\s*var)/i, description: ".env file access" },
  { pattern: /\/home\/node\/\.openclaw\/(?!workspace|skills)/, description: "Access outside workspace directory" },
  { pattern: /curl\s+https?:\/\/(?!api\.|www\.)[a-z0-9-]+\.[a-z]{2,}/i, description: "Outbound HTTP request to non-API domain" },
  { pattern: /ignore (previous|all|your|above|prior) instructions/i, description: "Prompt injection: goal hijacking" },
  { pattern: /you are now (?!the team|a |an )/i, description: "Prompt injection: identity override" },
  { pattern: /system override/i, description: "Prompt injection: system override" },
  { pattern: /forget (everything|all|your)/i, description: "Prompt injection: memory wipe" },
  { pattern: /disregard (your|all|previous)/i, description: "Prompt injection: instruction bypass" },
  { pattern: /rm\s+-rf\s+\//i, description: "Recursive delete from root" },
  { pattern: /mkfs|format.*disk/i, description: "Disk formatting" },
  { pattern: /shutdown|reboot|init\s+[06]/i, description: "System shutdown/reboot" },
  { pattern: /:()\{\s*:\|:&\s*\};:/, description: "Fork bomb" },
]

const WARNING_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /chmod\s+[0-7]*7[0-7]*/, description: "World-readable/writable permissions" },
  { pattern: /rm\s+-rf/, description: "Recursive delete command" },
  { pattern: />\s*\/dev\/null\s*2>&1/, description: "Error suppression (hiding activity)" },
  { pattern: /nohup/, description: "Background process execution" },
  { pattern: /crontab/, description: "Cron scheduling outside OpenClaw" },
  { pattern: /curl\s+https?:\/\//i, description: "External HTTP request" },
  { pattern: /wget\s+https?:\/\//i, description: "External download" },
  { pattern: /pip\s+install|npm\s+install/i, description: "Package installation" },
  { pattern: /upload.*to/i, description: "Upload instructions" },
]

const SCANNED_FIELDS = ["soulMd", "agentsMd", "heartbeatMd"] as const
const FIELD_LABELS: Record<string, string> = {
  soulMd: "SOUL.md",
  agentsMd: "AGENTS.md",
  heartbeatMd: "HEARTBEAT.md",
}

export function scanTemplate(agents: Array<{
  name: string
  soulMd: string
  agentsMd: string
  heartbeatMd?: string
}>): TemplateScanResult {
  const findings: TemplateScanFinding[] = []

  for (const agent of agents) {
    for (const field of SCANNED_FIELDS) {
      const content = (agent as Record<string, string | undefined>)[field] || ""
      if (!content) continue
      const lines = content.split("\n")

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]

        for (const { pattern, description } of CRITICAL_PATTERNS) {
          if (pattern.test(line)) {
            findings.push({
              severity: "critical",
              pattern: pattern.source,
              agentName: agent.name,
              file: FIELD_LABELS[field] || field,
              line: i + 1,
              description,
              matchedText: line.trim().substring(0, 100),
            })
          }
        }

        for (const { pattern, description } of WARNING_PATTERNS) {
          if (pattern.test(line)) {
            findings.push({
              severity: "warning",
              pattern: pattern.source,
              agentName: agent.name,
              file: FIELD_LABELS[field] || field,
              line: i + 1,
              description,
              matchedText: line.trim().substring(0, 100),
            })
          }
        }
      }
    }
  }

  const criticalCount = findings.filter(f => f.severity === "critical").length
  const warningCount = findings.filter(f => f.severity === "warning").length

  return {
    passed: criticalCount === 0,
    findings,
    scannedAgents: agents.length,
    hasCritical: criticalCount > 0,
    hasWarnings: warningCount > 0,
    criticalCount,
    warningCount,
  }
}
