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

/** Template-parity critical patterns (PR-3 harden). */
const CRITICAL_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /curl.*\$\{?[A-Z_]*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i, description: "Credential exfiltration via curl" },
  { pattern: /wget.*\$\{?[A-Z_]*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i, description: "Credential exfiltration via wget" },
  { pattern: /base64\s+(encode|decode)/i, description: "Base64 obfuscation" },
  { pattern: /eval\s*\(/, description: "Code execution via eval" },
  { pattern: /\$\(.*\$\{/, description: "Nested command substitution with variables" },
  { pattern: /\/etc\/(shadow|passwd)/i, description: "System password file access" },
  { pattern: /~\/.ssh\//, description: "SSH key directory access" },
  { pattern: /\/home\/node\/\.openclaw\/(?!workspace|skills)/, description: "Access outside workspace directory" },
  { pattern: /ignore (previous|all|above|prior) instructions/i, description: "Prompt injection: goal hijacking" },
  { pattern: /disregard (your|all|previous) (instructions|rules|guidelines)/i, description: "Prompt injection: instruction bypass" },
  { pattern: /rm\s+-rf\s+\//i, description: "Recursive delete from root" },
  { pattern: /mkfs\s/, description: "Disk formatting" },
  { pattern: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/, description: "Fork bomb" },
]

/** Template-parity warning patterns (PR-3 harden). */
const WARNING_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /send.*(api.?key|token|secret|password|credential).*to\s+(http|external|webhook)/i, description: "May send credentials externally" },
  { pattern: /\.env\s+file|\.env\b(?!\w)/i, description: ".env file reference" },
  { pattern: /\/root\//, description: "Root directory reference" },
  { pattern: /curl\s+https?:\/\/(?!api\.|www\.)[a-z0-9-]+\.[a-z]{2,}/i, description: "Outbound HTTP to non-API domain" },
  { pattern: /system\s+override/i, description: "System override reference" },
  { pattern: /forget\s+(everything|all\s+your)/i, description: "Memory wipe instruction" },
  { pattern: /chmod\s+[0-7]*7[0-7]*/, description: "World-readable/writable permissions" },
  { pattern: /rm\s+-rf/, description: "Recursive delete command" },
  { pattern: />\s*\/dev\/null\s*2>&1/, description: "Error suppression (hiding activity)" },
  { pattern: /nohup/, description: "Background process execution" },
  { pattern: /crontab/, description: "Cron scheduling outside OpenClaw" },
  { pattern: /pip\s+install|npm\s+install/i, description: "Package installation" },
  { pattern: /shutdown\s+(the\s+)?(server|system|machine)/i, description: "System shutdown reference" },
  { pattern: /reboot\s+(the\s+)?(server|system|machine)/i, description: "System reboot reference" },
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

/** Exported for mutation tests — skill criticals must include injection class. */
export const SKILL_CRITICAL_PATTERN_DESCRIPTIONS = CRITICAL_PATTERNS.map((p) => p.description)
export const SKILL_WARNING_PATTERN_DESCRIPTIONS = WARNING_PATTERNS.map((p) => p.description)
