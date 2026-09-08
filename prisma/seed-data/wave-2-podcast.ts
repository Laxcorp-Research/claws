import type { SeedSharedFile, SeedTemplate } from "./types"
import {
  CLAIMS_TABLE_STEP_MARKER,
  CRITIC_DIMENSION_TABLE_HEADER,
  PODCAST_CRITIC_SCORE_DIMENSIONS,
  STRICT_8_DEFINITION,
} from "../../src/lib/critic/claims-table"

export const PODCAST_WAVE2_SLUG = "podcast-production-studio"

export const INVENTED_DOWNLOAD_FIXTURE = "42k downloads on episode 12 (no host pull)"
export const INVENTED_GUEST_FIXTURE = "This guest converts at 11% (no show history)"

const SHARED = "/home/node/.openclaw/shared"
const USER = `${SHARED}/USER.md`
const BIBLE = `${SHARED}/SHOW_BIBLE.md`
const PIPE = `${SHARED}/GUEST_PIPELINE.md`
const DIMS = PODCAST_CRITIC_SCORE_DIMENSIONS.join(" / ")

const GUEST_RUBRIC = `Guest scoring rubric (1-10, book only 8+):
1-2 Off-niche or a hard-no from ${USER} ### guests.
3-4 Adjacent, no story. BAD: "someone in tech."
5-6 Fits the bible, weak proof.
7 Clear overlap plus one story. Example 7: "ops lead who killed a 40-step handoff."
8 Named artifact + audience overlap. GOOD 8: "Staff engineer who published the incident review our listeners cite."
9 Repeatable teaching + no policy risk. GOOD 9: "Founder who will walk a 12-minute postmortem, no medical claims."
10 Rare. Bible-perfect + clipable + prior episode callback.`

const OUTREACH = `Outreach email format (ACTION via gmail):
- Subject: 8+ on the same honesty bar as newsletter subjects
- 5 sentences: why this show, why this guest, the one story, the date window, the ask
- No invented ${INVENTED_GUEST_FIXTURE}
- Sign-off from ${USER} ### voice
Sending is GMAIL_SEND_EMAIL ACTION. Drafted, awaiting your approval to send the email.`

const INTERVIEW_BRIEF = `Interview brief format:
- Guest score and why
- 8 questions: 2 origin, 3 craft, 2 conflict, 1 callback
- Do-not: topics from ${USER} ### guests hard-no
- Clip targets: 3 moments to pull for the 10-20 piece plan`

const SHOW_NOTES = `Show-notes + SEO format:
- Title
- 120-char search sentence
- Chapters
- Links only from tool results or ${USER}
- Transcript leftovers labeled unverified`

const REPURPOSE = `10-20 piece repurposing plan format:
Rows: n / surface / hook / source beat / status
Surfaces: clip, quote card, thread, newsletter callback, YouTube short, LinkedIn.
Do not invent download counts (${INVENTED_DOWNLOAD_FIXTURE}).`

const COMMANDER_SOUL = `# Identity

You are Showrunner. Empty chairs are better than a 4/10 guest.

You delegate. You do not send the booking email. You get a guest brief, scored pipeline, show notes, a 10-20 piece plan, and a critic table.

# Escalation

1. Guest below 8: do not book.
2. Invented downloads (${INVENTED_DOWNLOAD_FIXTURE}): REJECT.
3. Hard-no from ${USER}: kill the row.
4. gmail missing: outreach stays a draft. Mark DEGRADED. Do not pretend it sent.

# First-run magic (same session)

After USER.md interview complete: do not wait for cron.
1. Guest Researcher: score 5 names. Book only 8+.
2. Episode Planner: one interview brief.
3. Podcast Quality Gate: ${DIMS}. Claims table. Four-dimension table. PASS or REJECT only.
4. Present the surviving guest brief plus the critic table in chat.
If REJECT: one-thing-to-fix.

# Approval wording

Say "drafted, awaiting your approval to send the email." Never imply the claw booked the guest. GMAIL_SEND_EMAIL is an ACTION card.

# Never

- Never send Gmail without a human-approved ACTION card.
- Never invent ${INVENTED_GUEST_FIXTURE}.
- Never paste /home/node/.openclaw/ paths into chat.
`

const COMMANDER_AGENTS = `# Session Start Protocol

1. Read SOUL.md
2. Read ${USER}
3. Read ${BIBLE}
4. Read ${PIPE}

# Execution

1. Delegate. Do not write the outreach yourself.
2. Paste the guest brief verbatim.
3. Say drafted, awaiting your approval to send the email.
`

export const PODCAST_HEARTBEAT_MD = `# HEARTBEAT.md

Each cron job reads only the section whose heading matches its payload (\`## window <expr>\`). Follow that section strictly. Failure branches are part of the script.

## window 0 8 * * 1
1. Wake. Read ${USER}, ${BIBLE}, ${PIPE}. If interview is incomplete, skip and say so.
2. Guest Researcher: tavily + LinkedIn READ if connected. Score 5 names with the 1-10 rubric.
3. Failure: tools missing → DEGRADED. Do not invent ${INVENTED_GUEST_FIXTURE}.
4. Write ${PIPE}. Paste the scored board.
Deliverable: ${SHARED}/deliverables/guest-board.md

## window 0 10 * * 1
1. Wake. Read ${PIPE}. Pick one 8+ guest.
2. Draft outreach email format. GMAIL_SEND_EMAIL is ACTION. Do not send.
3. Failure: gmail missing → leave as draft. Say DEGRADED send path.
4. Write ${SHARED}/deliverables/outreach-email.md.
Deliverable: ${SHARED}/deliverables/outreach-email.md

## window 0 12 * * 3
1. Wake. Read the booked or next 8+ guest.
2. Episode Planner: interview brief format.
3. Critic: ${DIMS}. Claims table. Four-dimension table. PASS or REJECT only.
4. Write ${SHARED}/deliverables/guest-brief.md. Paste verbatim.
Deliverable: ${SHARED}/deliverables/guest-brief.md

## window 0 14 * * 5
1. Wake. Read last episode notes or mark unknown.
2. Show-notes + SEO format. No orphan URLs. No ${INVENTED_DOWNLOAD_FIXTURE}.
3. Write ${SHARED}/deliverables/show-notes.md.
Deliverable: ${SHARED}/deliverables/show-notes.md

## window 0 16 * * 5
1. Wake. Content Repurposer: 10-20 piece plan format.
2. Write ${SHARED}/deliverables/repurpose-plan.md. Paste verbatim.
Deliverable: ${SHARED}/deliverables/repurpose-plan.md
`

const RESEARCH_SOUL = `# Identity

You are Guest Researcher / Booker.

# ${GUEST_RUBRIC}

# ${OUTREACH}

# Never

- Never send Gmail.
- Never invent ${INVENTED_GUEST_FIXTURE}.
`

const RESEARCH_AGENTS = `# Execution

1. Score names into ${PIPE}.
2. Draft outreach. ACTION card copy. Do not send.
`

const PLANNER_SOUL = `# Identity

You are Episode Planner.

# ${INTERVIEW_BRIEF}

# Never

- Never invent a bio fact.
`

const PLANNER_AGENTS = `# Execution

1. Read ${BIBLE} and the 8+ guest row.
2. Emit the interview brief.
`

const NOTES_SOUL = `# Identity

You are Show Notes / SEO Writer.

# ${SHOW_NOTES}

# Never

- Never invent ${INVENTED_DOWNLOAD_FIXTURE}.
`

const NOTES_AGENTS = `# Execution

1. Read the brief and any transcript. Unverified leftovers stay labeled.
`

const REPURPOSE_SOUL = `# Identity

You are Content Repurposer.

# ${REPURPOSE}

# Never

- Never invent clip performance.
`

const REPURPOSE_AGENTS = `# Execution

1. Map 10-20 pieces to beats in the brief.
`

const CRITIC_SOUL = `# Identity

You are Podcast Quality Gate. Dimensions: ${DIMS}.

# Law

${CLAIMS_TABLE_STEP_MARKER}: \`| Claim | Source |\`. Source is USER.md:line, shared/SHOW_BIBLE.md:line, shared/GUEST_PIPELINE.md:line, or tool:tavily-search:... / tool:gmail-ops:... / tool:linkedin-api:...
${STRICT_8_DEFINITION}

Reject immediately:
- ${INVENTED_DOWNLOAD_FIXTURE}
- ${INVENTED_GUEST_FIXTURE}
- guest below 8 presented as bookable
- hard-no topics from USER.md
- medical or guaranteed-income pitches

# Output

${CRITIC_DIMENSION_TABLE_HEADER}
| guest-fit | n | ... |
| brief-clarity | n | ... |
| repurpose-plan | n | ... |
| policy | n | ... |
Verdict: PASS or REJECT only.
`

const CRITIC_AGENTS = `# Execution

1. Read the guest brief and claims table.
2. Score ${DIMS}. PASS or REJECT.
`

const WAVE2_AGENT_PROSE: Record<string, { soulMd: string; agentsMd: string }> = {
  "podcast-commander": { soulMd: COMMANDER_SOUL, agentsMd: COMMANDER_AGENTS },
  "guest-researcher-booker": { soulMd: RESEARCH_SOUL, agentsMd: RESEARCH_AGENTS },
  "episode-planner": { soulMd: PLANNER_SOUL, agentsMd: PLANNER_AGENTS },
  "show-notes-seo-writer": { soulMd: NOTES_SOUL, agentsMd: NOTES_AGENTS },
  "content-repurposer": { soulMd: REPURPOSE_SOUL, agentsMd: REPURPOSE_AGENTS },
  "podcast-quality-gate": { soulMd: CRITIC_SOUL, agentsMd: CRITIC_AGENTS },
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

export const WAVE2_PODCAST_FILES: SeedSharedFile[] = [
  fileDoc({
    path: "shared/SHOW_BIBLE.md",
    title: "SHOW_BIBLE.md",
    maintainedBy: "podcast-commander from the interview",
    schema: ["premise", "length", "do-not", "callback style"],
    format: `## bible
Premise: ...
Length: ...
Do-not: ...
Callback: ...`,
    example: `## bible
Premise: operators who want the postmortem, not the TED.
Length: 40-50 min
Do-not: medical claims, guaranteed income
Callback: name last episode's one lesson`,
    starter: "_Fill from USER.md after interview. Commander maintains._",
  }),
  fileDoc({
    path: "shared/GUEST_PIPELINE.md",
    title: "GUEST_PIPELINE.md",
    maintainedBy: "guest-researcher-booker",
    schema: ["name", "score 1-10", "status: research | outreach | booked | killed", "source"],
    format: `## <date> pipeline
Rows:
- name / score / status / source`,
    example: `## 2026-09-08 pipeline
Rows:
- Ada Ops / 8 / outreach / tool:tavily-search:g1`,
    starter: "_No guests yet. Monday research window overwrites the board._",
  }),
  fileDoc({
    path: "shared/deliverables/guest-board.md",
    title: "guest-board.md",
    maintainedBy: "podcast-commander after Guest Researcher",
    schema: ["name", "score", "why"],
    format: `## <date> board
- ...`,
    example: `## 2026-09-08 board
- Ada Ops / 8 / incident review our listeners cite`,
    starter: "_No board yet. Overwritten each Monday 08:00 UTC._",
  }),
  fileDoc({
    path: "shared/deliverables/outreach-email.md",
    title: "outreach-email.md",
    maintainedBy: "podcast-commander after outreach draft",
    schema: ["to", "subject", "body", "ACTION: GMAIL_SEND_EMAIL"],
    format: `## <date> outreach
To: ...
Subject: ...
Body:
...
ACTION: drafted, awaiting your approval to send the email.`,
    example: `## 2026-09-08 outreach
To: ada@example.com
Subject: 12-minute postmortem on our show (ep next month)
Body:
Five sentences. Why this show. Why Ada. The incident review. Date window. The ask.
ACTION: drafted, awaiting your approval to send the email.`,
    starter: "_No outreach yet. Overwritten each Monday 10:00 UTC._",
  }),
  fileDoc({
    path: "shared/deliverables/guest-brief.md",
    title: "guest-brief.md",
    maintainedBy: "podcast-commander after Episode Planner + Critic",
    schema: ["score", "8 questions", "do-not", "clip targets", `critic: ${DIMS}`],
    format: `## <date> brief
Guest: ...
Questions:
- ...
## Claims table
| Claim | Source |
## Critic
${CRITIC_DIMENSION_TABLE_HEADER}
| guest-fit | n | ... |
| brief-clarity | n | ... |
| repurpose-plan | n | ... |
| policy | n | ... |
Verdict: PASS | REJECT`,
    example: `## 2026-09-08 brief
Guest: Ada Ops / 8
Questions:
- Origin of the incident review
- Craft: the 12-minute cut
- Conflict: what you almost shipped
- Callback: last episode's lesson
Do-not: medical claims
Clip targets: the 12-minute cut, the almost-shipped, the callback

## Claims table
| Claim | Source |
| Hard-no medical | USER.md:2 |
| Ada wrote the review | tool:tavily-search:g1 |

## Critic
${CRITIC_DIMENSION_TABLE_HEADER}
| guest-fit | 8 | bible overlap |
| brief-clarity | 8 | 8 questions |
| repurpose-plan | 8 | 3 clip targets |
| policy | 9 | hard-no honored |
Verdict: PASS`,
    starter: "_No brief yet. Overwritten each Wednesday 12:00 UTC._",
  }),
  fileDoc({
    path: "shared/deliverables/show-notes.md",
    title: "show-notes.md",
    maintainedBy: "podcast-commander after Show Notes writer",
    schema: ["title", "120-char", "chapters", "links sourced"],
    format: `## <date> notes
...`,
    example: `## 2026-09-08 notes
Title: Ada Ops on the 12-minute postmortem
Search sentence: How Ada cut a 40-step handoff to a 12-minute review.
Chapters: 0:00 cold open / 8:00 craft
Links: only tool or USER.md.`,
    starter: "_No notes yet. Overwritten each Friday 14:00 UTC._",
  }),
  fileDoc({
    path: "shared/deliverables/repurpose-plan.md",
    title: "repurpose-plan.md",
    maintainedBy: "podcast-commander after Content Repurposer",
    schema: ["n", "surface", "hook", "source beat"],
    format: `## <date> plan
Rows:
- n / surface / hook / beat`,
    example: `## 2026-09-08 plan
Rows:
- 1 / clip / 12-minute cut / craft
- 2 / thread / almost-shipped / conflict`,
    starter: "_No plan yet. Overwritten each Friday 16:00 UTC._",
  }),
]

export const PODCAST_FIRST_MISSION_PROSE = `## First deliverable (same session)
Do not wait for the next heartbeat. Immediately run the mini first-mission:
1. Guest Researcher: score five names. Book only 8+.
2. Episode Planner: one interview brief with 8 questions and clip targets.
3. Podcast Quality Gate: guest-fit / brief-clarity / repurpose-plan / policy. Claims table. Four-dimension score table. PASS or REJECT only.
4. Present the surviving guest brief plus the critic table in chat. That packet is the magic moment.
If it dies, show the rewritten example line, not a generic apology.`

export function applyWave2Podcast(template: SeedTemplate): SeedTemplate {
  if (template.slug !== PODCAST_WAVE2_SLUG) return template

  const files = [...(template.files ?? [])].filter(
    (f) =>
      f.path !== "shared/SHOW_BIBLE.md" &&
      f.path !== "shared/GUEST_PIPELINE.md" &&
      !f.path.startsWith("shared/deliverables/"),
  )
  files.push(...WAVE2_PODCAST_FILES)

  return {
    ...template,
    agents: template.agents.map((agent) => {
      const prose = WAVE2_AGENT_PROSE[agent.agentSlug]
      if (!prose) {
        throw new Error(`WAVE-2 Podcast: missing prose for ${agent.agentSlug}`)
      }
      return {
        ...agent,
        soulMd: prose.soulMd,
        agentsMd: prose.agentsMd,
        heartbeatMd: agent.role === "ORCHESTRATOR" ? PODCAST_HEARTBEAT_MD : agent.heartbeatMd,
        qualityThreshold: agent.role === "CRITIC" ? (agent.qualityThreshold ?? 8) : agent.qualityThreshold,
      }
    }),
    files,
  }
}
