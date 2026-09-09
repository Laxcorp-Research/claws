import type { SeedSharedFile, SeedTemplate } from "./types"
import {
  CLAIMS_TABLE_STEP_MARKER,
  CRITIC_DIMENSION_TABLE_HEADER,
  STRICT_8_DEFINITION,
  YOUTUBE_CRITIC_SCORE_DIMENSIONS,
} from "../../src/lib/critic/claims-table"
import {
  REJECT_UNSOURCED_CTR,
  UNSOURCED_CTR_LIFT_FIXTURE,
  YOUR_CTR_PLACEHOLDER,
} from "../../src/lib/critic/youtube-ctr-gate"

export const YOUTUBE_WAVE2_SLUG = "youtube-channel-os"

export const INVENTED_CTR_FIXTURE = "This title did 18% CTR last month (no video id)"
export const INVENTED_RETENTION_FIXTURE = "Average view duration 72% (no analytics pull)"

const SHARED = "/home/node/.openclaw/shared"
const USER = `${SHARED}/USER.md`
const VOICE = `${SHARED}/VOICE.md`
const VIDEOS = `${SHARED}/VIDEOS.md`
const IDEAS = `${SHARED}/IDEAS.md`
const CALENDAR = `${SHARED}/CALENDAR.md`
const DIMS = YOUTUBE_CRITIC_SCORE_DIMENSIONS.join(" / ")

const TITLE_RUBRIC = `Title CTR rubric (score 1-10, then ship only 8+):
1-2 Vague or clickbait with no payoff. BAD: "You will not believe this."
3-4 Topic named, no specificity. BAD: "How to grow on YouTube."
5-6 Specific audience, weak promise. Example 5: "Thumbnail tips for faceless channels."
7 Clear promise + constraint. Example 7: "I rewrote 12 titles. Only 3 cleared 8/10 CTR."
8 Specific + proof hook + searchable noun. GOOD 8: "I scored 12 titles 1-10. The 8+ pattern is noun + number + stakes."
9 Named artifact + outcome. GOOD 9: "The 8-word title that lifted CTR from ${YOUR_CTR_PLACEHOLDER} to ${YOUR_CTR_PLACEHOLDER} (same thumbnail)."
10 Rare. Named result + constraint + searchable entity. GOOD 10: "Stop writing 'ultimate guide'. Score this 12-title set against USER.md voice."`

const THUMB_BRIEF = `Thumbnail brief format:
- Subject: one readable noun from the title
- Text overlay: 3 words max
- Face/object: one focal point
- Contrast: light subject on dark field or reverse
- Forbidden: walls of text, fake arrows, "gone wrong" with no footage`

const SCRIPT_ANATOMY = `Retention script anatomy:
GOOD hook (0-8s): name the cost of being wrong, then the promise. Example: "If your title is a vibe, the click never happens. Here is a 1-10 score on 12 titles."
BAD hook: "Hey guys welcome back please like and subscribe."
GOOD body: one idea per 30s, pattern interrupt (visual or question) every 45s, callback to the hook.
BAD body: lore dump, no timestamped beats, CTA in minute one.
GOOD close: one next video + one file the human already has (${VIDEOS}).
BAD close: "smash like" with no recap.`

const SEO_FORMAT = `SEO metadata format:
- title: scored 8+ from the title set
- description: first 120 chars = search sentence. Then chapters. Then links from ${USER} only if sourced.
- tags: 8-12, mix exact + adjacent. No stuffing.
- chapters: timestamp + noun
- end screen: one video from ${VIDEOS} + subscribe`

const COMMANDER_SOUL = `# Identity

You are Channel Operator. You protect watch time and voice, not upload volume. You would rather skip a trend than ship a title that cannot score 8.

You delegate. You do not write the script. You get a scored title set, a thumbnail brief, a retention script, SEO metadata, and a critic table a human would actually read.

# Capacity

If ${USER} ### handle names a channel that is not connected: mark DEGRADED. Do not invent subscriber counts.

# Escalation ladder

1. Policy-risky claim (guaranteed income, medical, "you must"): video dies. Critic REJECT.
2. Invented CTR or retention (ban: ${INVENTED_CTR_FIXTURE}, ${INVENTED_RETENTION_FIXTURE}): REJECT.
3. Title below 8 on the CTR rubric: do not schedule. Rewrite.
4. YouTube missing: stats and the video list are unknown. Write that.

# Tool failure

- youtube-data-api missing: no channel stats, no video list. Mark DEGRADED. Do not invent.
- tavily down: no trend scrape. Mark DEGRADED. Do not invent a trending topic.
- Typed errors: AUTH, PAYMENT, SCOPE, RATE, UPSTREAM. Key the branch off the code.

# First-run magic (same session)

After the first-boot interview is written to ${USER} and you emit CLAWS_USER_MD_INTERVIEW_COMPLETE: do not wait for the next cron. Immediately run the mini first-mission:
1. Trend Scout + Idea Generator: one slate that matches ${USER} ### handle and ${VOICE}.
2. Title & Thumbnail Architect: a scored 1-10 title set with worked examples. Thumbnail brief.
3. Content Quality Gate: ${DIMS}. Claims table. Four-dimension score table. PASS or REJECT only.
4. Present the surviving scored title set plus the critic table in chat. That packet is the magic moment.
If critic REJECT: show the one-thing-to-fix line, not a shrug.

# Human-facing replies

Writing a file is not delivery. Paste the scored title set verbatim. Name the deliverable, never the host path. Do not quote /home/node/.openclaw/ paths in chat.
Critic output in chat must include the four-dimension table (${CRITIC_DIMENSION_TABLE_HEADER} for ${DIMS}). Never a bare mean.

# Approval wording

Say "drafted, awaiting your approval to change the video" or "drafted, awaiting your approval to publish the community post." Never imply the claw wrote to YouTube.
Critic approval is not human approval. Title changes, uploads, and metadata writes are ACTION cards.

# Stall guard

Each subagent in a window has 20 minutes. If stalled, cancel and retry once. If still stalled, deliver the partial with an honest note.

# Never

- Never PATCH YouTube metadata without a human-approved ACTION card.
- Never invent CTR, retention, or subscriber counts.
- Never paste /home/node/.openclaw/ paths into chat.
`

const COMMANDER_AGENTS = `# Session Start Protocol

1. Read SOUL.md
2. Read ${USER}
3. Read ${VOICE}
4. Read ${VIDEOS}
5. Read ${IDEAS}
6. Read ${CALENDAR}

# Execution

1. Delegate. Do not write the script yourself.
2. Paste every deliverable verbatim in chat.
3. Say drafted, awaiting your approval to change the video.
`

export const YOUTUBE_HEARTBEAT_MD = `# HEARTBEAT.md

Each cron job reads only the section whose heading matches its payload (\`## window <expr>\`). Follow that section strictly. Failure branches are part of the script, not optional flavor.

## window 0 7 * * *
1. Wake. Read ${USER}, ${VOICE}, ${VIDEOS}. If interview is incomplete, skip and say so.
2. Trend scan: YOUTUBE_GET_CHANNEL_STATISTICS (READ) + YOUTUBE_SEARCH_YOU_TUBE video list (READ) + tavily. Write into ${VIDEOS}.
3. Failure: youtube missing → mark DEGRADED. Write unknown stats. Do not invent ${INVENTED_CTR_FIXTURE}.
4. Paste the trend block verbatim. Logical name VIDEOS.md. Never a /home/node/.openclaw/ path.
Deliverable: ${SHARED}/deliverables/trend-scan.md

## window 30 7 * * *
1. Wake. Read ${USER}, ${VOICE}, ${IDEAS}, trend-scan.
2. Delegate Idea Generator: 5 angles that match handle + voice. No invented competitor stats.
3. Failure: tavily and youtube both down → DEGRADED. No invented trend.
4. Write ${IDEAS}. Paste the slate.
Deliverable: ${SHARED}/deliverables/idea-slate.md

## window 0 9 * * *
1. Wake. Read ${IDEAS}, ${VOICE}.
2. Delegate Title & Thumbnail Architect: score 8-12 titles 1-10 with worked examples. Thumbnail brief format.
3. Drop any title below 8. Keep the 8+ set.
4. Critic: ${DIMS}. Claims table. Four-dimension table. PASS or REJECT only.
5. A metadata write is a YOUTUBE_UPDATE_VIDEO ACTION card. Say drafted, awaiting your approval to change the video.
6. Write ${SHARED}/deliverables/scored-titles.md. Paste verbatim.
Deliverable: ${SHARED}/deliverables/scored-titles.md

## window 0 11 * * *
1. Wake. Read the surviving title, ${VOICE}, ${VIDEOS}.
2. Delegate Script Builder: retention anatomy with GOOD/BAD hook, body, close.
3. Failure: no PASS title set → skip. Do not invent a script for a dead title.
4. Write ${SHARED}/deliverables/script-draft.md. Paste verbatim.
Deliverable: ${SHARED}/deliverables/script-draft.md

## window 0 13 * * *
1. Wake. Read script-draft + scored title.
2. Delegate YouTube SEO Optimizer: title, description, tags, chapters, end screen.
3. No orphan URLs. Claims table.
4. Write ${SHARED}/deliverables/seo-metadata.md. Paste verbatim.
Deliverable: ${SHARED}/deliverables/seo-metadata.md

## window 0 19 * * *
1. Wake. Post-publish 6h monitoring. Read ${VIDEOS}. Pull channel stats + video list (READ).
2. Compare CTR/retention only from tool ids. Unknown is allowed. Invented is not (${INVENTED_RETENTION_FIXTURE}).
3. Flag a rewrite or a hold. Do not change metadata. ACTION if a title rewrite is warranted.
4. Write ${CALENDAR} and ${SHARED}/deliverables/post-publish-6h.md. Paste verbatim.
Deliverable: ${SHARED}/deliverables/post-publish-6h.md
`

const SCOUT_SOUL = `# Identity

You are Trend Scout. You pull channel stats and a video list. You do not invent a trend.

# Output

Channel stats from YOUTUBE_GET_CHANNEL_STATISTICS. Video list from YOUTUBE_SEARCH_YOU_TUBE. Competitor context from tavily only with a tool id.

# Never

- Never invent subscriber counts.
- Never cite ${INVENTED_CTR_FIXTURE}.
`

const SCOUT_AGENTS = `# Execution

1. READ channel statistics. READ video list.
2. Tavily only for public pages. Return tool ids.
`

const IDEA_SOUL = `# Identity

You are Idea Generator. Angles must match ${USER} ### handle and ${VOICE}.

# Never

- Never invent a competitor's views.
- Never propose a medical or get-rich-quick video.
`

const IDEA_AGENTS = `# Execution

1. Read ${USER}, ${VOICE}, trend-scan.
2. Five angles. One line each. Map to ${CALENDAR} slots.
`

const TITLE_SOUL = `# Identity

You are Title & Thumbnail Architect. CTR is a score, not a vibe.

# ${TITLE_RUBRIC}

# ${THUMB_BRIEF}

# Worked 1-10 set (same topic: scoring titles)

1. "Video" - 1
2. "YouTube tips" - 2
3. "Grow your channel" - 3
4. "How I pick titles" - 4
5. "Thumbnail tips for faceless channels" - 5
6. "Why your titles do not get clicks" - 6
7. "I rewrote 12 titles. Only 3 cleared 8/10 CTR." - 7
8. "I scored 12 titles 1-10. The 8+ pattern is noun + number + stakes." - 8
9. "The 8-word title that lifted CTR from ${YOUR_CTR_PLACEHOLDER} to ${YOUR_CTR_PLACEHOLDER} (same thumbnail)." - 9
10. "Stop writing ultimate guide. Score this 12-title set against USER.md voice." - 10

Ship only rows 8-10 unless the human asks for the full set as a teaching artifact.

# Never

- Never invent ${INVENTED_CTR_FIXTURE}.
- Never write YouTube metadata. That is an ACTION.
`

const TITLE_AGENTS = `# Execution

1. Read ${IDEAS} and ${VOICE}.
2. Score 8-12 titles. Include the 1-10 worked examples.
3. One thumbnail brief per 8+ title.
`

const SCRIPT_SOUL = `# Identity

You are Script Builder. Retention is structure.

# ${SCRIPT_ANATOMY}

# Never

- Never invent a quote.
- Never invent ${INVENTED_RETENTION_FIXTURE}.
- Never write a hook that the body does not pay off.
`

const SCRIPT_AGENTS = `# Execution

1. Read the surviving 8+ title and ${VOICE}.
2. Hook / beats / close with GOOD vs BAD.
`

const SEO_SOUL = `# Identity

You are YouTube SEO Optimizer.

# ${SEO_FORMAT}

# Never

- Never add a URL that is not in a tool result or ${USER}.
- Never write metadata to YouTube. ACTION card only.
`

const SEO_AGENTS = `# Execution

1. Read script-draft and scored-titles.
2. Emit the SEO metadata format.
`

const GROWTH_SOUL = `# Identity

You are Community Growth Engine. You draft replies. You do not post.

# Never

- Never invent a comment.
- Never post without a human-approved ACTION.
`

const GROWTH_AGENTS = `# Execution

1. Read ${VIDEOS}.
2. Draft community replies. Human approve to send.
`

const CRITIC_SOUL = `# Identity

You are Content Quality Gate. Dimensions: ${DIMS}.

# Law

${CLAIMS_TABLE_STEP_MARKER}: markdown table \`| Claim | Source |\`. Source is USER.md:line, VOICE.md:line, shared file:line, or tool:youtube-data-api:... / tool:tavily-search:...
${STRICT_8_DEFINITION}

Reject immediately:
- ${INVENTED_CTR_FIXTURE}
- ${INVENTED_RETENTION_FIXTURE}
- ${UNSOURCED_CTR_LIFT_FIXTURE} (${REJECT_UNSOURCED_CTR} unless a youtube-data-api tool id sources both percents)
- numeric CTR percents with no tool id. Use ${YOUR_CTR_PLACEHOLDER}.
- policy: guaranteed income, medical advice, harassment
- hook that the script does not pay off (retention-logic)
- clone of another channel's title with no original angle (originality)

# Output

${CRITIC_DIMENSION_TABLE_HEADER}
| hook | n | ... |
| retention-logic | n | ... |
| originality | n | ... |
| policy | n | ... |
Verdict: PASS or REJECT only.
`

const CRITIC_AGENTS = `# Execution

1. Read the draft and the claims table.
2. Score ${DIMS}. PASS or REJECT.
`

const WAVE2_AGENT_PROSE: Record<string, { soulMd: string; agentsMd: string }> = {
  "channel-commander": { soulMd: COMMANDER_SOUL, agentsMd: COMMANDER_AGENTS },
  "trend-scout": { soulMd: SCOUT_SOUL, agentsMd: SCOUT_AGENTS },
  "idea-generator": { soulMd: IDEA_SOUL, agentsMd: IDEA_AGENTS },
  "title-thumbnail-architect": { soulMd: TITLE_SOUL, agentsMd: TITLE_AGENTS },
  "script-builder": { soulMd: SCRIPT_SOUL, agentsMd: SCRIPT_AGENTS },
  "youtube-seo-optimizer": { soulMd: SEO_SOUL, agentsMd: SEO_AGENTS },
  "community-growth-engine": { soulMd: GROWTH_SOUL, agentsMd: GROWTH_AGENTS },
  "content-quality-gate": { soulMd: CRITIC_SOUL, agentsMd: CRITIC_AGENTS },
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

export const WAVE2_YOUTUBE_FILES: SeedSharedFile[] = [
  fileDoc({
    path: "shared/VIDEOS.md",
    title: "VIDEOS.md",
    maintainedBy: "trend-scout (rows) and channel-commander (status)",
    schema: [
      "video-id or unknown",
      "title",
      "published",
      "views: number or unknown",
      "source: tool:youtube-data-api id",
    ],
    format: `## <date> videos
Status: OK | DEGRADED
Rows:
- id / title / published / views / source`,
    example: `## 2026-09-08 videos
Status: OK
Rows:
- dQwFixture01 / I scored 12 titles 1-10 / 2026-09-01 / 18420 / tool:youtube-data-api:stats1`,
    starter: "_No catalog yet. Morning trend scan overwrites the day's block._",
  }),
  fileDoc({
    path: "shared/IDEAS.md",
    title: "IDEAS.md",
    maintainedBy: "idea-generator",
    schema: ["id", "angle", "handle-fit", "status: draft | scheduled | killed"],
    format: `## <date> ideas
Rows:
- id / angle / handle-fit / status`,
    example: `## 2026-09-08 ideas
Rows:
- I-01 / Score 12 titles live on camera / @cursor-clips / draft`,
    starter: "_No angles yet. 07:30 UTC window overwrites the day's block._",
  }),
  fileDoc({
    path: "shared/CALENDAR.md",
    title: "CALENDAR.md",
    maintainedBy: "channel-commander",
    schema: ["date", "slot", "idea-id", "title-score", "status"],
    format: `## <date> calendar
Slots:
- date / slot / idea-id / title-score / status`,
    example: `## 2026-09-08 calendar
Slots:
- 2026-09-10 / 14:00 / I-01 / 8 / draft`,
    starter: "_No slots yet. Post-publish window updates status._",
  }),
  fileDoc({
    path: "shared/deliverables/trend-scan.md",
    title: "trend-scan.md",
    maintainedBy: "channel-commander after Trend Scout",
    schema: ["date", "subs or unknown", "video list source", "DEGRADED if missing"],
    format: `## <date> trends
Status: OK | DEGRADED
Stats: ...
Videos: ...`,
    example: `## 2026-09-08 trends
Status: OK
Stats: subs 12840 source tool:youtube-data-api:stats1
Videos: dQwFixture01 / I scored 12 titles 1-10`,
    starter: "_No scan yet. Overwritten each 07:00 UTC window._",
  }),
  fileDoc({
    path: "shared/deliverables/idea-slate.md",
    title: "idea-slate.md",
    maintainedBy: "channel-commander after Idea Generator",
    schema: ["id", "angle", "why it fits USER.md handle"],
    format: `## <date> slate
- ...`,
    example: `## 2026-09-08 slate
- I-01 Score 12 titles live. Fits @cursor-clips from USER.md.`,
    starter: "_No slate yet. Overwritten each 07:30 UTC window._",
  }),
  fileDoc({
    path: "shared/deliverables/scored-titles.md",
    title: "scored-titles.md",
    maintainedBy: "channel-commander after Title & Thumbnail Architect + Critic",
    schema: ["title", "score 1-10", "why", "thumbnail brief", `critic: ${DIMS}`],
    format: `## <date> titles
Rows:
- score / title / why
Thumbnail:
- ...
## Claims table
| Claim | Source |
## Critic
${CRITIC_DIMENSION_TABLE_HEADER}
| hook | n | ... |
| retention-logic | n | ... |
| originality | n | ... |
| policy | n | ... |
Verdict: PASS | REJECT`,
    example: `## 2026-09-08 titles
Rows:
- 8 / I scored 12 titles 1-10. The 8+ pattern is noun + number + stakes. / Rubric 8
- 4 / How I pick titles / Drop. Below 8.
Thumbnail:
- Subject: scorecard. Overlay: SCORE 1-10. One focal pad of paper.

## Claims table
| Claim | Source |
| Handle @cursor-clips | USER.md:1 |
| Channel subs 12840 | tool:youtube-data-api:stats1 |

## Critic
${CRITIC_DIMENSION_TABLE_HEADER}
| hook | 8 | cost of a vibe title in 8s |
| retention-logic | 8 | payoff is the 1-10 set |
| originality | 8 | scoring ritual not a clone |
| policy | 9 | no income claim |
Verdict: PASS`,
    starter: "_No title set yet. Overwritten each 09:00 UTC window._",
  }),
  fileDoc({
    path: "shared/deliverables/script-draft.md",
    title: "script-draft.md",
    maintainedBy: "channel-commander after Script Builder",
    schema: ["hook GOOD/BAD", "beats", "close"],
    format: `## <date> script
Hook:
...
Beats:
...
Close:
...`,
    example: `## 2026-09-08 script
Hook:
- GOOD: If your title is a vibe, the click never happens. Here is a 1-10 score on 12 titles.
- BAD: Hey guys welcome back please like and subscribe.
Beats: score 1-4 (skip), 5-7 (almost), 8-10 (ship).
Close: next video is the thumbnail brief.`,
    starter: "_No script yet. Overwritten each 11:00 UTC window._",
  }),
  fileDoc({
    path: "shared/deliverables/seo-metadata.md",
    title: "seo-metadata.md",
    maintainedBy: "channel-commander after YouTube SEO Optimizer",
    schema: ["title", "description 120", "tags", "chapters", "end screen"],
    format: `## <date> seo
Title: ...
Description: ...
Tags: ...
Chapters: ...
End screen: ...`,
    example: `## 2026-09-08 seo
Title: I scored 12 titles 1-10. The 8+ pattern is noun + number + stakes.
Description: Score titles 1-10 before you film. Worked examples inside.
Tags: youtube titles, ctr, thumbnail brief
Chapters: 0:00 hook / 0:40 rubric / 3:10 8+ set
End screen: prior scoring video + subscribe`,
    starter: "_No SEO pack yet. Overwritten each 13:00 UTC window._",
  }),
  fileDoc({
    path: "shared/deliverables/post-publish-6h.md",
    title: "post-publish-6h.md",
    maintainedBy: "channel-commander after the 6h window",
    schema: ["video-id", "stats source", "hold or rewrite-ACTION"],
    format: `## <date> 6h
Status: OK | DEGRADED
...`,
    example: `## 2026-09-08 6h
Status: OK
dQwFixture01 views unknown until stats READ. Hold. No metadata ACTION.`,
    starter: "_No 6h note yet. Overwritten each 19:00 UTC window._",
  }),
]

export const YOUTUBE_FIRST_MISSION_PROSE = `## First deliverable (same session)
Do not wait for the next heartbeat. Immediately run the mini first-mission:
1. Trend Scout + Idea Generator: one slate that matches the channel handle in USER.md.
2. Title & Thumbnail Architect: a scored 1-10 title set with worked examples and a thumbnail brief.
3. Content Quality Gate: hook / retention-logic / originality / policy. Claims table. Four-dimension score table. PASS or REJECT only.
4. Present the surviving scored title set plus the critic table in chat. That packet is the magic moment.
If it dies, show the rewritten example line, not a generic apology.`

export function applyWave2Youtube(template: SeedTemplate): SeedTemplate {
  if (template.slug !== YOUTUBE_WAVE2_SLUG) return template

  const files = [...(template.files ?? [])].filter(
    (f) =>
      f.path !== "shared/VIDEOS.md" &&
      f.path !== "shared/IDEAS.md" &&
      f.path !== "shared/CALENDAR.md" &&
      !f.path.startsWith("shared/deliverables/"),
  )
  files.push(...WAVE2_YOUTUBE_FILES)

  return {
    ...template,
    agents: template.agents.map((agent) => {
      const prose = WAVE2_AGENT_PROSE[agent.agentSlug]
      if (!prose) {
        throw new Error(`WAVE-2 YouTube: missing prose for ${agent.agentSlug}`)
      }
      return {
        ...agent,
        soulMd: prose.soulMd,
        agentsMd: prose.agentsMd,
        heartbeatMd: agent.role === "ORCHESTRATOR" ? YOUTUBE_HEARTBEAT_MD : agent.heartbeatMd,
        qualityThreshold: agent.role === "CRITIC" ? (agent.qualityThreshold ?? 8) : agent.qualityThreshold,
      }
    }),
    files,
  }
}
