import type {
  SandboxDryChecks,
  SandboxReportV1,
  SandboxViolation,
  SandboxViolationClass,
} from "@/lib/marketplace/sandbox-types"
import { SANDBOX_REPORT_VERSION } from "@/lib/marketplace/sandbox-types"

/** Instruction/tool egress — curl/wget/fetch (not bare URL mentions in docs). */
const EGRESS_PATTERNS: RegExp[] = [
  /\bcurl\s+https?:\/\//i,
  /\bwget\s+https?:\/\//i,
  /\bfetch\s*\(\s*['"`]https?:\/\//i,
  /\bcurl\s+['"`]?https?:\/\/(?!api\.anthropic\.com)/i,
]

const CRED_PATH_PATTERNS: RegExp[] = [
  /~\/\.ssh\//,
  /\/etc\/(shadow|passwd)/i,
  /\.env\b/,
  /\/home\/node\/\.openclaw\/(?!workspace|skills)/i,
  /Load secrets from \.env/i,
  /read\s+\.env/i,
]

const EVAL_EXFIL_PATTERNS: RegExp[] = [
  /\beval\s*\(/,
  /\$\(.*\$\{/,
  /base64\s+(encode|decode)/i,
  /curl.*\$\{?[A-Z_]*(KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i,
]

const PACKAGE_INSTALL_PATTERNS: RegExp[] = [
  /\bpip\s+install\b/i,
  /\bnpm\s+install\b/i,
  /\bapt(-get)?\s+install\b/i,
]

const CRED_CANARY_PATHS = [
  "/etc/shadow",
  "/etc/passwd",
  "~/.ssh/id_rsa",
  ".env",
  "/home/node/.openclaw/credentials",
]

export function gradeTextForViolations(
  text: string,
  source: SandboxViolation["source"],
): SandboxViolation[] {
  const out: SandboxViolation[] = []
  const push = (cls: SandboxViolationClass, detail: string) => {
    if (!out.some((v) => v.class === cls && v.detail === detail)) {
      out.push({ class: cls, detail, source })
    }
  }

  for (const re of EGRESS_PATTERNS) {
    if (re.test(text)) push("EGRESS_ATTEMPT", `matched ${re.source}`)
  }
  for (const re of CRED_PATH_PATTERNS) {
    if (re.test(text)) push("CRED_PATH_TOUCH", `matched ${re.source}`)
  }
  for (const re of EVAL_EXFIL_PATTERNS) {
    if (re.test(text)) push("EVAL_EXFIL", `matched ${re.source}`)
  }
  for (const re of PACKAGE_INSTALL_PATTERNS) {
    if (re.test(text)) push("PACKAGE_INSTALL", `matched ${re.source}`)
  }
  return out
}

export function runCredPathCanaries(skillMd: string): SandboxDryChecks["credPathCanaries"] {
  return CRED_CANARY_PATHS.map((path) => {
    const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const touched = new RegExp(escaped, "i").test(skillMd)
    return { path, touched }
  })
}

export function buildSandboxReport(args: {
  skillId: string
  contentDigest: string
  skillMd: string
  requiredBins: string[]
  requiredEnvVars: string[]
  binPresence?: Record<string, boolean>
  envPresence?: Record<string, boolean>
  agentTurnText?: string | null
  agentCompleted?: boolean
  agentModel?: string
  dockerImage: string
  harnessError?: string | null
  timedOut?: boolean
  oom?: boolean
  nonzeroExit?: boolean
  now?: Date
}): SandboxReportV1 {
  const violations: SandboxViolation[] = []

  if (args.harnessError) {
    violations.push({
      class: "HARNESS_ERROR",
      detail: args.harnessError,
      source: "harness",
    })
  }
  if (args.timedOut) {
    violations.push({
      class: "TIMEOUT",
      detail: "Sandbox job hit 12-minute hard cap",
      source: "harness",
    })
  }
  if (args.oom) {
    violations.push({
      class: "OOM",
      detail: "Sandbox process ran out of memory",
      source: "runtime",
    })
  }
  if (args.nonzeroExit) {
    violations.push({
      class: "NONZERO_EXIT",
      detail: "Sandbox process exited non-zero",
      source: "runtime",
    })
  }

  violations.push(...gradeTextForViolations(args.skillMd, "skill_md"))

  const credPathCanaries = runCredPathCanaries(args.skillMd)
  for (const c of credPathCanaries) {
    if (c.touched) {
      violations.push({
        class: "CRED_PATH_TOUCH",
        detail: `skill instructs or references canary path ${c.path}`,
        source: "dry",
      })
    }
  }

  if (args.agentTurnText) {
    violations.push(...gradeTextForViolations(args.agentTurnText, "agent"))
  }

  const bins = args.requiredBins.map((name) => ({
    name,
    present: args.binPresence?.[name] ?? false,
  }))
  const envVars = args.requiredEnvVars.map((name) => ({
    name,
    set: args.envPresence?.[name] ?? false,
  }))

  const deduped = dedupeViolations(violations)
  const failClosed =
    deduped.find((v) =>
      ["HARNESS_ERROR", "TIMEOUT", "OOM", "NONZERO_EXIT"].includes(v.class),
    )?.class ?? undefined

  const passed = deduped.length === 0

  return {
    version: SANDBOX_REPORT_VERSION,
    skillId: args.skillId,
    contentDigest: args.contentDigest,
    passed,
    violations: deduped,
    dryChecks: { bins, envVars, credPathCanaries },
    agentTurn: args.agentTurnText !== undefined
      ? {
          model: args.agentModel ?? "claude-haiku-4-5-20251001",
          completed: !!args.agentCompleted,
          summary: args.agentTurnText?.slice(0, 500),
          rawExcerpt: args.agentTurnText?.slice(0, 2000),
        }
      : null,
    dockerImage: args.dockerImage,
    finishedAt: (args.now ?? new Date()).toISOString(),
    failClosedReason: failClosed as SandboxViolationClass | undefined,
  }
}

function dedupeViolations(violations: SandboxViolation[]): SandboxViolation[] {
  const seen = new Set<string>()
  const out: SandboxViolation[] = []
  for (const v of violations) {
    const key = `${v.class}|${v.source}|${v.detail}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(v)
  }
  return out
}

export function parseSandboxReport(raw: string | null | undefined): SandboxReportV1 | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as SandboxReportV1
    if (parsed?.version !== 1 || typeof parsed.contentDigest !== "string") return null
    return parsed
  } catch {
    return null
  }
}

export function reportMatchesDigest(
  raw: string | null | undefined,
  contentDigest: string,
): boolean {
  const report = parseSandboxReport(raw)
  return !!report && report.contentDigest === contentDigest
}
