import type { SeedTemplate } from "./types"
import { applyWave4Overlay, wave4NamedFile } from "./wave-4-apply"
import {
  CLAIMS_TABLE_STEP_MARKER,
  CRITIC_DIMENSION_TABLE_HEADER,
  RE_CRITIC_SCORE_DIMENSIONS,
  STRICT_8_DEFINITION,
} from "../../src/lib/critic/claims-table"

export const RE_WAVE4_SLUG = "real-estate-agent-os"
const SHARED = "/home/node/.openclaw/shared"
const USER = `${SHARED}/USER.md`
const MARKET = `${SHARED}/MARKET.md`
const LISTINGS = `${SHARED}/LISTINGS.md`
const DIMS = RE_CRITIC_SCORE_DIMENSIONS.join(" / ")

const CMA_FORMAT = `CMA format:
1. Subject: address + beds/baths/sf from ${LISTINGS} (file:line)
2. Comps: 3-5 closed sales, each with close date, sold price, and a tool id
3. Adjustments table: beds, baths, sf, condition (facts only)
4. Indicated range. Never a guaranteed list price.
5. Fair Housing: listing facts only. No coded neighborhood phrases.`

const SHOWING_CAP = `Showing-route cap: at most 5 showings per calendar day. A sixth slot is an ACTION card for the human, never auto-booked.`

const SPEED_TO_LEAD = `Speed-to-lead: first human-facing reply within 60 seconds of a new inquiry. If gmail or twilio is down, mark DEGRADED and still draft the reply as an ACTION.`

export const RE_HEARTBEAT_MD = `# HEARTBEAT.md

Each cron job reads only the section whose heading matches its payload (\`## window <expr>\`). Follow that section strictly.

## window 0 8 * * *
1. Wake. Read ${USER}, ${MARKET}, ${LISTINGS}. If interview is incomplete, skip and say so.
2. Delegate Lead Qualifier: overnight leads. ${SPEED_TO_LEAD}
3. Delegate Market Intel: one CMA in the CMA format. Facts from ${LISTINGS} plus comps with tool ids.
4. Delegate Showing Coordinator: today's route. ${SHOWING_CAP}
5. Failure: tavily and MLS-class tools down → DEGRADED CMA from ${MARKET} only. Do not invent a sold price.
6. Write ${SHARED}/deliverables/re-morning-brief.md. Paste verbatim. MLS status change is an ACTION.

## window 0 18 * * *
1. Wake. Read ${LISTINGS}.
2. Delegate Client Communicator: tour wrap without invented feedback.
3. Queue tomorrow's showings. Cap still 5/day.
4. Critic: Fair Housing + claims table. Write re-evening-wrap.md.

## window 0 9 * * 1
1. Wake. Read ${USER}, ${MARKET}, ${LISTINGS}.
2. Delegate Market Intel: weekly farm update. Inventory facts tied to ${LISTINGS}.
3. Write ${MARKET} weekly section plus re-weekly-pipeline.md.

## window 0 9 1 * *
1. Compile monthly performance from logged showings and lead sources. No demographic inferences.
2. Write re-monthly-performance.md.
`

export const RE_FIRST_MISSION_PROSE = `## First deliverable (same session)
Do not wait for the next heartbeat. Immediately run the mini first-mission:
1. Lead Qualifier: score one fixture lead. ${SPEED_TO_LEAD}
2. Market Intel: one CMA in the CMA format (comps need a tool id or [YOUR COMP]).
3. Showing Coordinator: a route of at most 5 stops.
4. Real Estate Quality Gate: ${DIMS}. Claims table. Four-dimension table. PASS or REJECT only.
5. Present the surviving CMA plus the critic table in chat. MLS status change is an ACTION card. Say drafted, awaiting your approval.
If it dies, show the one-thing-to-fix line, not a generic apology.`

const FILES = [
  wave4NamedFile({
    path: "shared/MARKET.md",
    title: "MARKET.md",
    maintainedBy: "market-intel-agent",
    schema: [
      "area: zip or neighborhood from USER.md ### market",
      "metric: DOM | inventory | list-to-sale",
      "value: latest reading",
      "asOf: ISO date",
      "source: tool id or LISTINGS.md:line",
    ],
    format: "One row per metric. No demographic commentary.",
    example: "| 94110 | DOM | 18 | 2026-09-08 | tool:tavily:r1 |",
    entries: "_No market rows yet. Market Intel Agent maintains this file._",
  }),
  wave4NamedFile({
    path: "shared/LISTINGS.md",
    title: "LISTINGS.md",
    maintainedBy: "listing-commander",
    schema: [
      "id: listing id",
      "address: street (no coded neighborhood labels)",
      "status: active | pending | closed",
      "price: list price",
      "facts: beds/baths/sf",
    ],
    format: "Facts only. Fair Housing: never 'family neighborhood' or similar.",
    example: "| L-1 | 12 Oak St | active | 890000 | 3/2/1400 |",
    entries: "_No listings yet. Listing Commander maintains this inventory._",
  }),
  wave4NamedFile({
    path: "shared/deliverables/cma.md",
    title: "cma.md",
    maintainedBy: "market-intel-agent",
    schema: ["subject", "comps", "adjustments", "indicated-range", "claims-table"],
    format: CMA_FORMAT,
    example: "Subject 12 Oak St. Comp A sold 2026-08-01 $875k tool:tavily:r2. Range $860k-$910k. Not a guarantee.",
    entries: "_Empty until Market Intel writes the first CMA._",
  }),
]

const ADDENDA = {
  "listing-commander": {
    soulMd: `# WAVE-4 operations

You are Listing Commander. ${SPEED_TO_LEAD} ${SHOWING_CAP}

# First-run magic (same session)

After USER.md interview is complete: run the mini first-mission. MLS status change is an ACTION.

# Never

- Never invent a sold price.
- Never auto-book a sixth showing.
- Never use Fair Housing coded phrases.
`,
  },
  "lead-qualifier": {
    soulMd: `# WAVE-4 lead protocol

${SPEED_TO_LEAD}
Score readiness, budget, timeline from what they said. No protected-class inference.
`,
  },
  "market-intel-agent": {
    soulMd: `# WAVE-4 CMA

${CMA_FORMAT}
Write ${MARKET} and cma.md. Comps without a tool id are [YOUR COMP], not a number you guessed.
`,
  },
  "showing-coordinator": {
    soulMd: `# WAVE-4 showing route

${SHOWING_CAP}
Calendar writes are ACTION cards.
`,
  },
  "client-communicator": {
    soulMd: `# WAVE-4 client wrap

Tour feedback must come from a tool or file:line. Invented "they loved the kitchen" is REJECT.
`,
  },
  "real-estate-quality-gate": {
    soulMd: `# WAVE-4 critic law

Dimensions: ${DIMS}.
${CLAIMS_TABLE_STEP_MARKER}: markdown table \`| Claim | Source |\`.
${STRICT_8_DEFINITION}

neverApprove:
- Fair Housing coded phrase ('family neighborhood', steering)
- CMA with an unsourced sold price
- sixth showing auto-booked
- speed-to-lead miss presented as already sent

# Output

${CRITIC_DIMENSION_TABLE_HEADER}
| fair-housing | n | ... |
| cma-accuracy | n | ... |
| speed-to-lead | n | ... |
| tone | n | ... |
Verdict: PASS or REJECT only.
`,
  },
}

export function applyWave4RealEstate(template: SeedTemplate): SeedTemplate {
  return applyWave4Overlay({
    template,
    slug: RE_WAVE4_SLUG,
    addenda: ADDENDA,
    heartbeatMd: RE_HEARTBEAT_MD,
    files: FILES,
    dropPaths: ["shared/MARKET.md", "shared/LISTINGS.md"],
  })
}
