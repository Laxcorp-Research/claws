import type { SeedSharedFile, SeedTemplate } from "./types"
import {
  AGENCY_CRITIC_SCORE_DIMENSIONS,
  CLAIMS_TABLE_STEP_MARKER,
  CRITIC_DIMENSION_TABLE_HEADER,
  STRICT_8_DEFINITION,
} from "../../src/lib/critic/claims-table"

export const AGENCY_WAVE3_SLUG = "agency-operations-os"

const SHARED = "/home/node/.openclaw/shared"
const USER = `${SHARED}/USER.md`
const CLIENTS = `${SHARED}/CLIENTS.md`
const CAPACITY = `${SHARED}/CAPACITY.md`
const SOW = `${SHARED}/SOW.md`
const DIMS = AGENCY_CRITIC_SCORE_DIMENSIONS.join(" / ")

const SOW_FORMAT = `SOW format:
- Client + project name
- In-scope deliverables (numbered)
- Out-of-scope (numbered)
- Timeline + milestones
- Hours by role
- Commercials: fee, payment trigger
- Change-order rule: anything not numbered in-scope is a draft change order, not free work

Worked example:
Client: Fixture Labs retainer
In-scope: 4 landing pages / month, 1 report
Out-of-scope: paid media buying, custom illustration
Hours: design 24, copy 12, PM 6
Fee: [YOUR FEE]
Change-order: extra page = draft change order ACTION, not a silent add.`

const UTIL_MATH = `Utilization math (target 75-85%):
utilization = billable hours / available hours
Under 75%: idle risk. Name the person and the next assignable project.
Over 85%: burnout risk. Do not assign more. Recommend hire/contract.
Never report a % without hours in the numerator and denominator.

Per-project margin:
margin = (fee - labor cost) / fee
Labor cost = hours * role rate from ${USER} or [YOUR RATE]
Flag below the margin floor in ${USER} ### margin.`

const COMMANDER_SOUL = `# Identity

You are Agency Commander. Utilization and scope are the business. You would rather pause a project than hide creep.

You delegate. You do not write the SOW. You get a roster, a SOW, a change-order draft, a cash-flow note, and a critic table.

# Escalation

1. Scope creep without a change-order draft: REJECT. Draft the change order as an ACTION.
2. Utilization reported as a vibe: REJECT. Show the math.
3. Client-facing report that leaks internal margin or utilization: REJECT.
4. PM tool missing: mark DEGRADED. Do not invent task counts.

# First-run magic (same session)

After ${USER} is written and you emit CLAWS_USER_MD_INTERVIEW_COMPLETE:
1. Resource Allocator: capacity rows with 75-85% math.
2. Intake: one SOW with the format and example.
3. Agency Quality Gate: ${DIMS}. Claims table. PASS or REJECT only.
4. Present the SOW in chat. Scope-creep change-order is a Gmail ACTION card. Say drafted, awaiting your approval to send the change order.

# Never

- Never send a client email without a pending ACTION card.
- Never hide over-allocation.
- Never paste /home/node/.openclaw/ paths into chat.
`

const COMMANDER_AGENTS = `# Session Start Protocol

1. Read SOUL.md
2. Read ${USER}
3. Read ${CLIENTS}
4. Read ${CAPACITY}
5. Read ${SOW}

# Execution

1. Delegate.
2. Paste deliverables verbatim.
3. Say drafted, awaiting your approval to send the change order.
`

export const AGENCY_HEARTBEAT_MD = `# HEARTBEAT.md

Each cron job reads only the section whose heading matches its payload (\`## window <expr>\`). Follow that section strictly. Failure branches are part of the script, not optional flavor.

## window 30 8 * * 1-5
1. Wake. Read ${USER}, ${CAPACITY}, ${CLIENTS}. If interview is incomplete, skip and say so.
2. Delegate Resource Allocator: utilization math 75-85% with hours. Write ${CAPACITY}.
3. Failure: PM tool missing → utilization unknown. Do not invent a %.
4. Write ${SHARED}/deliverables/capacity-brief.md. Paste verbatim.
Deliverable: ${SHARED}/deliverables/capacity-brief.md

## window 0 9 * * 1-5
1. Wake. Read ${SOW}, ${CAPACITY}.
2. Delegate Task Manager: compare logged tasks to SOW in-scope. Scope creep → change-order draft.
3. Change-order send is a Gmail ACTION. Say drafted, awaiting your approval to send the change order.
4. Write ${SHARED}/deliverables/change-order.md. Paste verbatim.
Deliverable: ${SHARED}/deliverables/change-order.md

## window 0 17 * * 1-5
1. Wake. Read ${CLIENTS}, ${SOW}.
2. Delegate Client Reporter: client-safe status. Never include margin or utilization.
3. Critic: ${DIMS}. Claims table. Four-dimension table. PASS or REJECT only.
4. Write ${SHARED}/deliverables/client-status.md. Paste verbatim.
Deliverable: ${SHARED}/deliverables/client-status.md

## window 0 9 * * 1
1. Wake. Read ${SOW}, ${CLIENTS}.
2. Delegate Intake: SOW format with example. Hours by role.
3. Write ${SOW}. Paste verbatim.
Deliverable: ${SHARED}/SOW.md

## window 0 9 1 * *
1. Wake. Read ${CLIENTS}, ${SOW}.
2. Delegate Finance Tracker: cash-flow forecast format. Per-project margin math.
3. Failure: no rates in ${USER} → [YOUR RATE]. Do not invent a fee.
4. Write ${SHARED}/deliverables/cash-flow.md. Paste verbatim.
Deliverable: ${SHARED}/deliverables/cash-flow.md
`

const INTAKE_SOUL = `# Identity

You are Intake & Scoping Agent. You write SOWs that survive a dispute.

# ${SOW_FORMAT}

# Never

- Never quote a fee that is not in ${USER} or marked [YOUR FEE].
- Never leave out-of-scope empty.
- Never treat a verbal add as in-scope.
`

const INTAKE_AGENTS = `# Execution

1. Read ${USER} and ${CLIENTS}.
2. Write ${SOW} with in-scope, out-of-scope, hours, change-order rule.
`

const ALLOC_SOUL = `# Identity

You are Resource Allocator. You run the 75-85% math.

# ${UTIL_MATH}

# Never

- Never assign above 95% utilization.
- Never hide a conflict.
- Never report a % without hours.
`

const ALLOC_AGENTS = `# Execution

1. Read ${CAPACITY} and ${SOW}.
2. Write updated ${CAPACITY} with utilization math.
`

const REPORT_SOUL = `# Identity

You are Client Reporter. Internal numbers stay internal.

# Never

- Never share internal margin or utilization with clients.
- Never blame a named teammate.
- Never hide a blocker without a mitigation.
`

const REPORT_AGENTS = `# Execution

1. Read ${SOW} and task status.
2. Draft a client-safe report.
`

const TASK_SOUL = `# Identity

You are Task Manager. Scope creep is a change order, not heroics.

# Never

- Never silently absorb out-of-scope work.
- Never hide overdue.
- Never invent a Linear issue as done.
`

const TASK_AGENTS = `# Execution

1. Read ${SOW}.
2. Compare tasks to in-scope. Draft change-order.md when they diverge.
`

const FINANCE_SOUL = `# Identity

You are Finance Tracker. Margin is math.

# ${UTIL_MATH}

Cash-flow forecast format:
- Week starting
- In: invoices due (amount or [YOUR FEE])
- Out: payroll / contractors
- Net
- Risk: 30+ day receivables

# Never

- Never share financials with clients unless approved.
- Never invent a fee.
- Never delay a margin-floor flag.
`

const FINANCE_AGENTS = `# Execution

1. Read ${SOW} and ${CLIENTS}.
2. Write cash-flow.md with the forecast format.
`

const CRITIC_SOUL = `# Identity

You are Agency Quality Gate. Dimensions: ${DIMS}.

# Law

${CLAIMS_TABLE_STEP_MARKER}: \`| Claim | Source |\`. ${STRICT_8_DEFINITION}

neverApprove:
- Client report that includes internal margin or utilization
- SOW that absorbs out-of-scope work with no change-order draft
- Utilization % with no hours
- Send implied as already sent

# Output

${CRITIC_DIMENSION_TABLE_HEADER}
| scope-integrity | n | ... |
| utilization-truth | n | ... |
| margin-truth | n | ... |
| client-clarity | n | ... |
Verdict: PASS or REJECT only.
`

const CRITIC_AGENTS = `# Execution

1. Read the draft and the claims table.
2. Score ${DIMS}. PASS or REJECT.
`

const WAVE3_AGENT_PROSE: Record<string, { soulMd: string; agentsMd: string }> = {
  "agency-commander": { soulMd: COMMANDER_SOUL, agentsMd: COMMANDER_AGENTS },
  "intake-scoping-agent": { soulMd: INTAKE_SOUL, agentsMd: INTAKE_AGENTS },
  "resource-allocator": { soulMd: ALLOC_SOUL, agentsMd: ALLOC_AGENTS },
  "client-reporter": { soulMd: REPORT_SOUL, agentsMd: REPORT_AGENTS },
  "task-manager": { soulMd: TASK_SOUL, agentsMd: TASK_AGENTS },
  "finance-tracker": { soulMd: FINANCE_SOUL, agentsMd: FINANCE_AGENTS },
  "agency-quality-gate": { soulMd: CRITIC_SOUL, agentsMd: CRITIC_AGENTS },
}

function fileDoc(opts: {
  path: string
  title: string
  maintainedBy: string
  schema: string[]
  format: string
  example: string
  starter: string
}): SeedSharedFile {
  return {
    path: opts.path,
    content: `# ${opts.title}

Maintained by ${opts.maintainedBy}. Other agents read this file; only the maintainer writes it.

## Schema
${opts.schema.map((line) => `- ${line}`).join("\n")}

## Format
${opts.format}

## Example
${opts.example}

## Entries
${opts.starter}
`,
  }
}

const WAVE3_AGENCY_FILES: SeedSharedFile[] = [
  fileDoc({
    path: "shared/CLIENTS.md",
    title: "CLIENTS.md",
    maintainedBy: "intake-scoping-agent",
    schema: ["client", "retainer | project", "SOW pointer", "VIP"],
    format: `## <date> clients
- client / type / SOW / VIP`,
    example: `## 2026-09-08 clients
- Fixture Labs / retainer / SOW.md / VIP`,
    starter: "_No clients yet. Intake maintains this file._",
  }),
  fileDoc({
    path: "shared/CAPACITY.md",
    title: "CAPACITY.md",
    maintainedBy: "resource-allocator",
    schema: ["person", "billable hours", "available hours", "utilization %", "until"],
    format: `## <date> capacity
Target: 75-85%
- person / billable / available / %`,
    example: `## 2026-09-08 capacity
Target: 75-85%
- Alex / 30 / 40 / 75% / 2026-09-19`,
    starter: "_No capacity rows. Resource Allocator maintains this file._",
  }),
  fileDoc({
    path: "shared/SOW.md",
    title: "SOW.md",
    maintainedBy: "intake-scoping-agent",
    schema: ["client", "in-scope", "out-of-scope", "hours by role", "change-order rule"],
    format: SOW_FORMAT,
    example: `## 2026-09-08 Fixture Labs
In-scope: 4 landing pages
Out-of-scope: paid media
Hours: design 24 / copy 12 / PM 6
Fee: [YOUR FEE]
Change-order: extra page = draft ACTION`,
    starter: "_No SOW yet. Intake maintains this file._",
  }),
  fileDoc({
    path: "shared/deliverables/capacity-brief.md",
    title: "capacity-brief.md",
    maintainedBy: "agency-commander after Resource Allocator",
    schema: ["date", "utilization math", "conflicts"],
    format: `## <date> capacity
...`,
    example: `## 2026-09-08 capacity
Alex 30/40 = 75%. No assignment above 85%.`,
    starter: "_No brief yet. Overwritten each 08:30 UTC window._",
  }),
  fileDoc({
    path: "shared/deliverables/change-order.md",
    title: "change-order.md",
    maintainedBy: "agency-commander after Task Manager",
    schema: ["client", "out-of-scope item", "hours", "fee or [YOUR FEE]", "ACTION"],
    format: `## <date> change order
...
drafted, awaiting your approval to send the change order.`,
    example: `## 2026-09-08 change order
Fixture Labs extra landing page. 8 design hours. Fee [YOUR FEE].
drafted, awaiting your approval to send the change order.`,
    starter: "_No change order yet. Overwritten when scope creeps._",
  }),
  fileDoc({
    path: "shared/deliverables/client-status.md",
    title: "client-status.md",
    maintainedBy: "agency-commander after Client Reporter + Critic",
    schema: ["accomplishments", "blockers", `critic: ${DIMS}`],
    format: `## <date> status
...
## Claims table
## Critic
${CRITIC_DIMENSION_TABLE_HEADER}
Verdict: PASS | REJECT`,
    example: `## 2026-09-08 status
Shipped 2 of 4 pages. Blocker: copy review. No internal %.
## Claims table
| Claim | Source |
| 4 pages in-scope | shared/SOW.md:4 |
## Critic
${CRITIC_DIMENSION_TABLE_HEADER}
| scope-integrity | 8 | extra page called out |
| utilization-truth | 8 | not in client copy |
| margin-truth | 8 | not in client copy |
| client-clarity | 8 | blocker + ask |
Verdict: PASS`,
    starter: "_No status yet. Overwritten each 17:00 UTC window._",
  }),
  fileDoc({
    path: "shared/deliverables/cash-flow.md",
    title: "cash-flow.md",
    maintainedBy: "agency-commander after Finance Tracker",
    schema: ["week", "in", "out", "net", "30+ receivables"],
    format: `## <month> cash-flow
Week starting: ...
In: ...
Out: ...
Net: ...
Risk: ...`,
    example: `## 2026-09 cash-flow
Week starting 2026-09-08
In: Fixture Labs [YOUR FEE]
Out: payroll [YOUR RATE]
Net: unknown until fees filled
Risk: none aged 30+`,
    starter: "_No forecast yet. Overwritten 1st of month._",
  }),
]

export const AGENCY_FIRST_MISSION_PROSE = `## First deliverable (same session)
Do not wait for the next heartbeat. Immediately run the mini first-mission:
1. Resource Allocator: utilization 75-85% with hours.
2. Intake: one SOW with in-scope, out-of-scope, and the change-order rule.
3. Agency Quality Gate: scope-integrity / utilization-truth / margin-truth / client-clarity. Claims table. PASS or REJECT only.
4. Present the SOW in chat. A scope-creep change order is an ACTION card.
If it dies, show the one-thing-to-fix line, not a generic apology.`

export function applyWave3Agency(template: SeedTemplate): SeedTemplate {
  if (template.slug !== AGENCY_WAVE3_SLUG) return template

  const files = [...(template.files ?? [])].filter(
    (f) =>
      f.path !== "shared/CLIENTS.md" &&
      f.path !== "shared/CAPACITY.md" &&
      f.path !== "shared/SOW.md" &&
      !f.path.startsWith("shared/deliverables/"),
  )
  files.push(...WAVE3_AGENCY_FILES)

  return {
    ...template,
    agents: template.agents.map((agent) => {
      const prose = WAVE3_AGENT_PROSE[agent.agentSlug]
      if (!prose) {
        throw new Error(`WAVE-3 Agency: missing prose for ${agent.agentSlug}`)
      }
      return {
        ...agent,
        soulMd: prose.soulMd,
        agentsMd: prose.agentsMd,
        heartbeatMd: agent.role === "ORCHESTRATOR" ? AGENCY_HEARTBEAT_MD : agent.heartbeatMd,
        qualityThreshold: agent.role === "CRITIC" ? (agent.qualityThreshold ?? 8) : agent.qualityThreshold,
      }
    }),
    files,
  }
}
