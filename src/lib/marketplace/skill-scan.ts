export interface SkillScanFinding {
  severity: "critical" | "warning"
  pattern: string
  line: number
  description: string
}

export interface SkillScanResult {
  passed: boolean
  findings: SkillScanFinding[]
  hasCritical: boolean
  hasWarnings: boolean
}

const CRITICAL_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /curl.*\$\{?[A-Z_]*KEY/i, description: "curl command with API key variable - potential key exfiltration" },
  { pattern: /curl.*\$\{?[A-Z_]*TOKEN/i, description: "curl command with token variable - potential token exfiltration" },
  { pattern: /curl.*\$\{?[A-Z_]*SECRET/i, description: "curl command with secret variable - potential secret exfiltration" },
  { pattern: /wget.*\$\{?[A-Z_]*KEY/i, description: "wget command with API key variable - potential key exfiltration" },
  { pattern: /base64\s+(encode|decode)/i, description: "Base64 encode/decode operations - potential data obfuscation" },
  { pattern: /eval\s*\(/, description: "eval() call - arbitrary code execution" },
  { pattern: /\$\(.*\$\{/, description: "Nested command substitution with variables - potential injection" },
  { pattern: /\/etc\/shadow/, description: "Access to /etc/shadow - system password file" },
  { pattern: /\/root\//, description: "Access to /root/ directory" },
  { pattern: /~\/.ssh/, description: "Access to SSH keys directory" },
  { pattern: /\.env(?!\s*var)/i, description: "Access to .env file (credentials)" },
  { pattern: /\/home\/node\/\.openclaw\/(?!skills)/, description: "Access to OpenClaw config outside skills directory" },
  { pattern: /curl\s+https?:\/\/(?!api\.|www\.)[a-z0-9-]+\.[a-z]{2,}/i, description: "Outbound HTTP request to non-API domain" },
]

const WARNING_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /chmod\s+[0-7]*7[0-7]*/, description: "World-readable/writable permission change" },
  { pattern: /rm\s+-rf/, description: "Recursive delete command" },
  { pattern: />\s*\/dev\/null\s*2>&1/, description: "Error suppression - may hide malicious activity" },
  { pattern: /nohup/, description: "Background process - may persist after skill execution" },
  { pattern: /crontab/, description: "Crontab modification - should use OpenClaw's cron system instead" },
]

export function scanSkillContent(skillMd: string): SkillScanResult {
  const findings: SkillScanFinding[] = []
  const lines = skillMd.split("\n")

  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum]

    for (const { pattern, description } of CRITICAL_PATTERNS) {
      if (pattern.test(line)) {
        findings.push({ severity: "critical", pattern: pattern.source, line: lineNum + 1, description })
      }
    }

    for (const { pattern, description } of WARNING_PATTERNS) {
      if (pattern.test(line)) {
        findings.push({ severity: "warning", pattern: pattern.source, line: lineNum + 1, description })
      }
    }
  }

  const hasCritical = findings.some((f) => f.severity === "critical")
  const hasWarnings = findings.some((f) => f.severity === "warning")

  return { passed: !hasCritical, findings, hasCritical, hasWarnings }
}
