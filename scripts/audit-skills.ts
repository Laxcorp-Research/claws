import dotenv from "dotenv"
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: ".env.local" })
}

import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" })
const prisma = new PrismaClient({ adapter })

// ---------------------------------------------------------------------------
// Expanded scan patterns — Layer 2 audit (Layer 1 lives in skill-scan.ts)
// ---------------------------------------------------------------------------

interface PatternDef {
  name: string
  pattern: RegExp
  description: string
}

// TIER 1: AUTO-UNPUBLISH — high confidence malicious or dangerous
const TIER1_AUTO_UNPUBLISH: PatternDef[] = [
  // Prompt injection / goal hijacking
  { name: "prompt-injection-ignore", pattern: /ignore\s+(all\s+)?previous\s+instructions/i, description: "Prompt injection: ignore previous instructions" },
  { name: "prompt-injection-youare", pattern: /you\s+are\s+now\s+(a|an|my)/i, description: "Prompt injection: identity override" },
  { name: "prompt-injection-system", pattern: /system\s+override/i, description: "Prompt injection: system override" },
  { name: "prompt-injection-forget", pattern: /forget\s+(everything|all|your)\s+(you|instructions|rules)/i, description: "Prompt injection: forget instructions" },
  { name: "prompt-injection-jailbreak", pattern: /\b(DAN|do\s+anything\s+now|jailbreak)\b/i, description: "Prompt injection: jailbreak attempt" },
  { name: "prompt-injection-pretend", pattern: /pretend\s+(you\s+)?(are|have)\s+no\s+(restrictions|rules|limits)/i, description: "Prompt injection: pretend no restrictions" },

  // Obfuscated exfiltration
  { name: "hex-encoded-url", pattern: /\\x[0-9a-f]{2}.*\\x[0-9a-f]{2}.*\\x[0-9a-f]{2}/i, description: "Hex-encoded content (possible obfuscated URL)" },
  { name: "base64-pipe", pattern: /\|\s*base64/i, description: "Piping content through base64 encoding" },
  { name: "xxd-encode", pattern: /\bxxd\b/i, description: "Hex dump utility (possible obfuscation)" },
  { name: "python-exec", pattern: /python[23]?\s+-c\s+['"]/i, description: "Inline Python execution" },
  { name: "node-eval", pattern: /node\s+-e\s+['"]/i, description: "Inline Node.js execution" },
  { name: "perl-exec", pattern: /perl\s+-e\s+['"]/i, description: "Inline Perl execution" },

  // Data exfiltration via DNS/network
  { name: "dns-exfil", pattern: /dig\s+.*\$|nslookup\s+.*\$/i, description: "DNS-based data exfiltration" },
  { name: "nc-netcat", pattern: /\b(nc|netcat|ncat)\s+(-[a-z]*\s+)*[0-9.]+/i, description: "Netcat connection (raw socket exfiltration)" },
  { name: "curl-post-file", pattern: /curl\s+.*-[dF]\s+@/i, description: "curl uploading file contents" },
  { name: "wget-post", pattern: /wget\s+.*--post/i, description: "wget POST request (data exfiltration)" },

  // Credential harvesting
  { name: "env-dump", pattern: /\benv\b\s*\||\bprintenv\b|\bset\b\s*\|/i, description: "Dumping environment variables" },
  { name: "cat-env-file", pattern: /cat\s+.*\.env/i, description: "Reading .env file contents" },
  { name: "echo-key-var", pattern: /echo\s+\$[A-Z_]*(KEY|TOKEN|SECRET|PASSWORD|CRED)/i, description: "Echoing credential variables" },
  { name: "history-access", pattern: /\.bash_history|\.zsh_history/i, description: "Accessing shell history" },

  // Filesystem attacks
  { name: "symlink-attack", pattern: /ln\s+-s.*\.(env|ssh|config)/i, description: "Symlink to sensitive files" },
  { name: "find-sensitive", pattern: /find\s+.*-name\s+.*\.(pem|key|crt|env)/i, description: "Searching for sensitive files" },
  { name: "tar-sensitive", pattern: /tar\s+.*\/(etc|root|home|\.ssh)/i, description: "Archiving sensitive directories" },

  // Process/system manipulation
  { name: "kill-process", pattern: /kill\s+-9\s+/i, description: "Force killing processes" },
  { name: "chmod-suid", pattern: /chmod\s+[4267][0-7]{3}/i, description: "Setting SUID/SGID bits" },
  { name: "useradd", pattern: /\b(useradd|adduser|usermod)\b/i, description: "User account manipulation" },
  { name: "iptables", pattern: /\biptables\b/i, description: "Firewall rule manipulation" },
  { name: "mount-device", pattern: /\bmount\s+\/dev/i, description: "Mounting devices" },
]

// TIER 2: FLAG FOR REVIEW — suspicious but could be legitimate
const TIER2_FLAG_REVIEW: PatternDef[] = [
  // Broad network access
  { name: "curl-arbitrary", pattern: /curl\s+\$\{?\w+\}?/i, description: "curl with variable URL (could be any destination)" },
  { name: "wget-arbitrary", pattern: /wget\s+\$\{?\w+\}?/i, description: "wget with variable URL" },
  { name: "fetch-arbitrary", pattern: /fetch\(\s*\$\{?\w+\}?\s*\)/i, description: "fetch() with variable URL" },

  // Excessive permissions
  { name: "sudo-usage", pattern: /\bsudo\b/i, description: "Requires sudo/root access" },
  { name: "chmod-777", pattern: /chmod\s+777/i, description: "World-writable permissions" },
  { name: "chmod-executable", pattern: /chmod\s+\+x/i, description: "Making files executable" },

  // Background/persistent processes
  { name: "ampersand-bg", pattern: /&\s*$/m, description: "Background process execution" },
  { name: "screen-tmux", pattern: /\b(screen|tmux)\s+(new|attach)/i, description: "Screen/tmux session (persistent process)" },
  { name: "daemon-flag", pattern: /--daemon|--background|-d\s+--/i, description: "Daemon/background flag" },

  // Package installation
  { name: "pip-install", pattern: /pip[3]?\s+install/i, description: "Installing Python packages at runtime" },
  { name: "npm-install", pattern: /npm\s+(install|i)\s+/i, description: "Installing npm packages at runtime" },
  { name: "apt-install", pattern: /apt(-get)?\s+install/i, description: "Installing system packages at runtime" },
  { name: "brew-install", pattern: /brew\s+install/i, description: "Installing Homebrew packages at runtime" },

  // File downloads
  { name: "download-script", pattern: /curl.*\|\s*(bash|sh|python)/i, description: "Downloading and piping to shell (curl | bash)" },
  { name: "download-execute", pattern: /wget.*&&\s*(chmod|bash|sh|\.\/)/i, description: "Download and execute pattern" },

  // Sensitive paths
  { name: "proc-access", pattern: /\/proc\/(self|[0-9])/i, description: "Accessing /proc filesystem" },
  { name: "sys-access", pattern: /\/sys\/(class|devices|kernel)/i, description: "Accessing /sys filesystem" },
  { name: "docker-socket", pattern: /\/var\/run\/docker\.sock/i, description: "Docker socket access (container escape)" },
  { name: "kube-config", pattern: /\.kube\/config|KUBECONFIG/i, description: "Kubernetes config access" },

  // Crypto mining indicators
  { name: "crypto-miner", pattern: /\b(xmrig|minerd|cryptonight|stratum\+tcp)\b/i, description: "Cryptocurrency mining" },
  { name: "hashrate", pattern: /hashrate|mining\s+pool/i, description: "Mining-related terminology" },

  // Outbound data in URL
  { name: "data-in-url", pattern: /https?:\/\/[^"'\s]*\$\{[^}]+\}/i, description: "Variable interpolation in URL (data exfiltration via GET params)" },
]

// TIER 3: INFORMATIONAL — worth knowing but usually benign
const TIER3_INFO: PatternDef[] = [
  { name: "writes-files", pattern: />\s+[\/~\w]/m, description: "Writes to filesystem" },
  { name: "reads-stdin", pattern: /read\s+-[rsp]/i, description: "Reads from stdin" },
  { name: "temp-files", pattern: /\/tmp\//i, description: "Uses /tmp directory" },
  { name: "sleep-command", pattern: /\bsleep\s+[0-9]/i, description: "Uses sleep (could be timing attack or just normal)" },
  { name: "loop-construct", pattern: /\bwhile\s+true\b|\bfor\s*\(\s*;\s*;\s*\)/i, description: "Infinite loop construct" },
  { name: "large-output", pattern: /cat\s+\/dev\/(urandom|random)/i, description: "Reading from random device (resource exhaustion)" },
]

// ---------------------------------------------------------------------------
// Scan engine
// ---------------------------------------------------------------------------

interface Finding {
  tier: 1 | 2 | 3
  name: string
  description: string
  lineNumber: number
  lineContent: string
}

interface SkillAuditResult {
  id: string
  slug: string
  name: string
  category: string
  tier1Count: number
  tier2Count: number
  tier3Count: number
  findings: Finding[]
}

function auditSkillContent(content: string): Finding[] {
  const findings: Finding[] = []
  const lines = content.split("\n")

  const tiers: Array<{ defs: PatternDef[]; tier: 1 | 2 | 3 }> = [
    { defs: TIER1_AUTO_UNPUBLISH, tier: 1 },
    { defs: TIER2_FLAG_REVIEW, tier: 2 },
    { defs: TIER3_INFO, tier: 3 },
  ]

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNumber = i + 1

    for (const { defs, tier } of tiers) {
      for (const check of defs) {
        if (check.pattern.test(line)) {
          findings.push({
            tier,
            name: check.name,
            description: check.description,
            lineNumber,
            lineContent: line.trim().slice(0, 120),
          })
        }
      }
    }
  }

  // Deduplicate: same pattern name only flagged once per skill (keep first occurrence)
  const seen = new Set<string>()
  return findings.filter((f) => {
    const key = `${f.tier}-${f.name}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== COMPREHENSIVE SKILL SECURITY AUDIT ===\n")

  const skills = await prisma.marketplaceSkill.findMany({
    where: {
      autoScanReport: { contains: "clawhub-sync" },
      isPublished: true,
    },
    select: {
      id: true,
      slug: true,
      name: true,
      category: true,
      skillMd: true,
    },
  })

  console.log(`Scanning ${skills.length} ClawHub-imported skills...\n`)

  const results: SkillAuditResult[] = []
  let tier1Total = 0
  let tier2Total = 0
  let tier3Total = 0

  for (const skill of skills) {
    const findings = auditSkillContent(skill.skillMd)

    if (findings.length > 0) {
      const result: SkillAuditResult = {
        id: skill.id,
        slug: skill.slug,
        name: skill.name,
        category: skill.category,
        tier1Count: findings.filter((f) => f.tier === 1).length,
        tier2Count: findings.filter((f) => f.tier === 2).length,
        tier3Count: findings.filter((f) => f.tier === 3).length,
        findings,
      }
      results.push(result)
      tier1Total += result.tier1Count
      tier2Total += result.tier2Count
      tier3Total += result.tier3Count
    }
  }

  results.sort((a, b) => {
    if (a.tier1Count !== b.tier1Count) return b.tier1Count - a.tier1Count
    if (a.tier2Count !== b.tier2Count) return b.tier2Count - a.tier2Count
    return b.tier3Count - a.tier3Count
  })

  // === REPORT ===

  console.log("=== SUMMARY ===")
  console.log(`Total skills scanned:    ${skills.length}`)
  console.log(`Clean (no findings):     ${skills.length - results.length}`)
  console.log(`Flagged:                 ${results.length}`)
  console.log(`  Tier 1 (auto-unpublish): ${results.filter((r) => r.tier1Count > 0).length} skills, ${tier1Total} findings`)
  console.log(`  Tier 2 (review needed):  ${results.filter((r) => r.tier2Count > 0).length} skills, ${tier2Total} findings`)
  console.log(`  Tier 3 (informational):  ${results.filter((r) => r.tier3Count > 0 && r.tier1Count === 0 && r.tier2Count === 0).length} skills (only tier 3), ${tier3Total} findings`)
  console.log("")

  // Tier 1 details
  const tier1Skills = results.filter((r) => r.tier1Count > 0)
  if (tier1Skills.length > 0) {
    console.log("=== TIER 1: AUTO-UNPUBLISH (CRITICAL) ===")
    for (const r of tier1Skills) {
      console.log(`\n  ${r.slug} (${r.category})`)
      for (const f of r.findings.filter((f) => f.tier === 1)) {
        console.log(`    [LINE ${f.lineNumber}] ${f.description}`)
        console.log(`      > ${f.lineContent}`)
      }
    }
    console.log("")
  }

  // Tier 2 summary (top 20)
  const tier2Skills = results.filter((r) => r.tier2Count > 0)
  if (tier2Skills.length > 0) {
    console.log("=== TIER 2: FLAG FOR REVIEW (top 20) ===")
    for (const r of tier2Skills.slice(0, 20)) {
      console.log(`\n  ${r.slug} (${r.category}) — ${r.tier2Count} findings`)
      for (const f of r.findings.filter((f) => f.tier === 2)) {
        console.log(`    [LINE ${f.lineNumber}] ${f.description}`)
      }
    }
    if (tier2Skills.length > 20) {
      console.log(`\n  ... and ${tier2Skills.length - 20} more skills with Tier 2 findings`)
    }
    console.log("")
  }

  // Tier 3 count only
  console.log("=== TIER 3: INFORMATIONAL ===")
  console.log(`  ${results.filter((r) => r.tier3Count > 0).length} skills with informational findings (benign, not listed)`)
  console.log("")

  // === AUTO-UNPUBLISH TIER 1 SKILLS ===
  if (tier1Skills.length > 0) {
    console.log(`=== AUTO-UNPUBLISHING ${tier1Skills.length} TIER 1 SKILLS ===`)

    const tier1Ids = tier1Skills.map((r) => r.id)

    await prisma.marketplaceSkill.updateMany({
      where: { id: { in: tier1Ids } },
      data: {
        isPublished: false,
        autoScanPassed: false,
        autoScanReport: JSON.stringify({
          source: "security-audit-v2",
          passed: false,
          auditDate: new Date().toISOString(),
          note: "Auto-unpublished by comprehensive security audit",
        }),
      },
    })

    console.log(`  Unpublished ${tier1Ids.length} skills.`)
    console.log(`  Slugs: ${tier1Skills.map((r) => r.slug).join(", ")}`)
  }

  // === SAVE FULL REPORT TO FILE ===
  const reportPath = `audit-report-${new Date().toISOString().slice(0, 10)}.json`
  const fs = await import("fs")
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        auditDate: new Date().toISOString(),
        totalScanned: skills.length,
        clean: skills.length - results.length,
        tier1Unpublished: tier1Skills.length,
        tier2ReviewNeeded: tier2Skills.length,
        tier3Informational: results.filter((r) => r.tier3Count > 0).length,
        tier1Details: tier1Skills.map((r) => ({
          slug: r.slug,
          name: r.name,
          category: r.category,
          findings: r.findings.filter((f) => f.tier === 1),
        })),
        tier2Details: tier2Skills.map((r) => ({
          slug: r.slug,
          name: r.name,
          category: r.category,
          findings: r.findings.filter((f) => f.tier === 2),
        })),
      },
      null,
      2,
    ),
  )
  console.log(`\nFull report saved to: ${reportPath}`)

  // === FINAL SUMMARY ===
  console.log("\n=== FINAL STATE ===")
  const publishedCount = await prisma.marketplaceSkill.count({ where: { isPublished: true } })
  const unpublishedCount = await prisma.marketplaceSkill.count({ where: { isPublished: false } })
  console.log(`Published skills:   ${publishedCount}`)
  console.log(`Unpublished skills: ${unpublishedCount}`)

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
