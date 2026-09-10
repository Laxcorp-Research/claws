import type { InterviewQuestion } from "../../prisma/seed-data/interview-packs"
import { TEMPLATE_INTERVIEW_PACKS } from "../../prisma/seed-data/interview-packs"
import { TWITTER_FIRST_MISSION_PROSE, TWITTER_WAVE0_SLUG } from "../../prisma/seed-data/wave-0-twitter"
import {
  FREELANCER_FIRST_MISSION_PROSE,
  FREELANCER_WAVE1_SLUG,
} from "../../prisma/seed-data/wave-1-freelancer"
import {
  QUANT_FIRST_MISSION_PROSE,
  QUANT_WAVE1_SLUG,
} from "../../prisma/seed-data/wave-1-quant"
import {
  ECOM_FIRST_MISSION_PROSE,
  ECOM_WAVE1_SLUG,
} from "../../prisma/seed-data/wave-1-ecom"
import {
  YOUTUBE_FIRST_MISSION_PROSE,
  YOUTUBE_WAVE2_SLUG,
} from "../../prisma/seed-data/wave-2-youtube"
import {
  NEWSLETTER_FIRST_MISSION_PROSE,
  NEWSLETTER_WAVE2_SLUG,
} from "../../prisma/seed-data/wave-2-newsletter"
import {
  PODCAST_FIRST_MISSION_PROSE,
  PODCAST_WAVE2_SLUG,
} from "../../prisma/seed-data/wave-2-podcast"
import {
  B2B_FIRST_MISSION_PROSE,
  B2B_WAVE3_SLUG,
} from "../../prisma/seed-data/wave-3-b2b"
import {
  AGENCY_FIRST_MISSION_PROSE,
  AGENCY_WAVE3_SLUG,
} from "../../prisma/seed-data/wave-3-agency"
import {
  COS_FIRST_MISSION_PROSE,
  COS_WAVE3_SLUG,
} from "../../prisma/seed-data/wave-3-cos"
import {
  SEO_FIRST_MISSION_PROSE,
  SEO_WAVE3_SLUG,
} from "../../prisma/seed-data/wave-3-seo"
import {
  RE_FIRST_MISSION_PROSE,
  RE_WAVE4_SLUG,
} from "../../prisma/seed-data/wave-4-real-estate"
import {
  RECRUITER_FIRST_MISSION_PROSE,
  RECRUITER_WAVE4_SLUG,
} from "../../prisma/seed-data/wave-4-recruiter"
import {
  MEDICAL_FIRST_MISSION_PROSE,
  MEDICAL_WAVE4_SLUG,
} from "../../prisma/seed-data/wave-4-medical"
import {
  LAW_FIRST_MISSION_PROSE,
  LAW_WAVE4_SLUG,
} from "../../prisma/seed-data/wave-4-law"
import {
  HOME_FIRST_MISSION_PROSE,
  HOME_WAVE4_SLUG,
} from "../../prisma/seed-data/wave-4-home"
import {
  HEALTH_FIRST_MISSION_PROSE,
  HEALTH_WAVE5_SLUG,
} from "../../prisma/seed-data/wave-5-health"
import {
  STUDENT_FIRST_MISSION_PROSE,
  STUDENT_WAVE5_SLUG,
} from "../../prisma/seed-data/wave-5-student"
import {
  JOB_FIRST_MISSION_PROSE,
  JOB_WAVE5_SLUG,
} from "../../prisma/seed-data/wave-5-job"
import {
  DEV_FIRST_MISSION_PROSE,
  DEV_WAVE5_SLUG,
} from "../../prisma/seed-data/wave-5-dev"
import { SHARED_HOST_ROOT } from "@/lib/workspace-seed-files"
import { PLATFORM_INTERVIEW_COMPLETE_TOKEN } from "@/lib/chat/platform-sentinels"

export const USER_MD_UNPACK_PATH = "shared/USER.md"
export const USER_MD_HOST_PATH = `${SHARED_HOST_ROOT}/USER.md`
export const USER_MD_INTERVIEW_COMPLETE_TOKEN = PLATFORM_INTERVIEW_COMPLETE_TOKEN

export function getInterviewPack(slug: string | null | undefined): InterviewQuestion[] | null {
  if (!slug) return null
  return TEMPLATE_INTERVIEW_PACKS[slug] ?? null
}

export function renderUserMdFromAnswers(
  pack: InterviewQuestion[],
  answers: Record<string, string>,
): string {
  const entries = pack
    .map((q) => {
      const answer = answers[q.id]?.trim() ?? ""
      return `### ${q.id}\n**Coverage:** ${q.coverage}\n**Prompt:** ${q.prompt}\n**Answer:** ${answer || "_unanswered_"}`
    })
    .join("\n\n")
  const complete = pack.every((q) => Boolean(answers[q.id]?.trim())) ? "yes" : "no"
  return `# USER.md

Maintained by the orchestrator from the first-boot interview. Other agents read this file; only the orchestrator writes it. The human can say "update my profile" to rewrite it.

## Schema
- id: question id from the template pack
- coverage: what this answer is for
- prompt: what was asked
- answer: the human's reply

## Entries
${entries}

## Interview complete
${complete}
`
}

export function parseUserMdAnswers(content: string): Record<string, string> {
  const out: Record<string, string> = {}
  const parts = content.split(/^### /m).slice(1)
  for (const part of parts) {
    const nl = part.indexOf("\n")
    if (nl < 0) continue
    const id = part.slice(0, nl).trim()
    const match = part.match(/\*\*Answer:\*\*\s*([\s\S]*?)(?=\n### |\n## |$)/)
    if (id && match) out[id] = match[1].trim()
  }
  return out
}

export function userMdInterviewFileIsComplete(content: string): boolean {
  return /^## Interview complete\s*\nyes\s*$/im.test(content)
}

export function formatInterviewBootSection(input: {
  interviewCompleted: boolean
  pack: InterviewQuestion[] | null
  templateSlug?: string | null
}): string {
  const always = `Human profile file: ${USER_MD_HOST_PATH} (this workspace USER.md is name/timezone identity only).
If ${USER_MD_HOST_PATH} already has "## Interview complete" set to yes, do not interview again.
If the human says "update my profile", rewrite that file from the conversation and keep the schema.`

  if (input.interviewCompleted || !input.pack || input.pack.length === 0) {
    return always
  }

  const bullets = input.pack
    .map((q) => `- ${q.id}: ${q.prompt} (${q.coverage})`)
    .join("\n")
  const firstBySlug: Record<string, string> = {
    [TWITTER_WAVE0_SLUG]: TWITTER_FIRST_MISSION_PROSE,
    [FREELANCER_WAVE1_SLUG]: FREELANCER_FIRST_MISSION_PROSE,
    [QUANT_WAVE1_SLUG]: QUANT_FIRST_MISSION_PROSE,
    [ECOM_WAVE1_SLUG]: ECOM_FIRST_MISSION_PROSE,
    [YOUTUBE_WAVE2_SLUG]: YOUTUBE_FIRST_MISSION_PROSE,
    [NEWSLETTER_WAVE2_SLUG]: NEWSLETTER_FIRST_MISSION_PROSE,
    [PODCAST_WAVE2_SLUG]: PODCAST_FIRST_MISSION_PROSE,
    [B2B_WAVE3_SLUG]: B2B_FIRST_MISSION_PROSE,
    [AGENCY_WAVE3_SLUG]: AGENCY_FIRST_MISSION_PROSE,
    [COS_WAVE3_SLUG]: COS_FIRST_MISSION_PROSE,
    [SEO_WAVE3_SLUG]: SEO_FIRST_MISSION_PROSE,
    [RE_WAVE4_SLUG]: RE_FIRST_MISSION_PROSE,
    [RECRUITER_WAVE4_SLUG]: RECRUITER_FIRST_MISSION_PROSE,
    [MEDICAL_WAVE4_SLUG]: MEDICAL_FIRST_MISSION_PROSE,
    [LAW_WAVE4_SLUG]: LAW_FIRST_MISSION_PROSE,
    [HOME_WAVE4_SLUG]: HOME_FIRST_MISSION_PROSE,
    [HEALTH_WAVE5_SLUG]: HEALTH_FIRST_MISSION_PROSE,
    [STUDENT_WAVE5_SLUG]: STUDENT_FIRST_MISSION_PROSE,
    [JOB_WAVE5_SLUG]: JOB_FIRST_MISSION_PROSE,
    [DEV_WAVE5_SLUG]: DEV_FIRST_MISSION_PROSE,
  }
  const mission = input.templateSlug ? firstBySlug[input.templateSlug] : undefined
  const firstMission = mission ? `\n\n${mission}` : ""
  return `${always}

## First-boot interview
This is a conversation, not a form. Use the pack as a coverage guide; skip anything they already volunteered.
${bullets}

When they confirm the profile, write ${USER_MD_HOST_PATH} and include ${USER_MD_INTERVIEW_COMPLETE_TOKEN} in your confirmation message.${firstMission}`
}

export function eventSignalsUserMdInterviewComplete(ev: {
  type?: string
  detail?: string | null
  metadata?: Record<string, unknown>
}): boolean {
  if (ev.metadata?.userMdInterviewComplete === true) return true
  const detail = typeof ev.detail === "string" ? ev.detail : ""
  if (detail.includes(USER_MD_INTERVIEW_COMPLETE_TOKEN)) return true
  const metaDetail = ev.metadata?.detail
  return typeof metaDetail === "string" && metaDetail.includes(USER_MD_INTERVIEW_COMPLETE_TOKEN)
}
