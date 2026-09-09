import { MONEY_MAKING_TEMPLATES } from "./money-making-templates"
import { CREATOR_TEMPLATES } from "./creator-templates"
import { BUSINESS_OPS_TEMPLATES } from "./business-ops-templates"
import { VERTICAL_TEMPLATES } from "./vertical-templates"
import { LIFESTYLE_TEMPLATES } from "./lifestyle-templates"
import { applySkillAttach } from "./skill-attach-map"
import { applySharedFiles } from "./shared-file-manifests"
import { applyInterviewSeed } from "./interview-packs"
import { applyMissionScripts } from "./mission-scripts"
import { applyWave0Twitter } from "./wave-0-twitter"
import { applyWave1Freelancer } from "./wave-1-freelancer"
import { applyWave1Quant } from "./wave-1-quant"
import { applyWave1Ecom } from "./wave-1-ecom"
import { applyWave2Youtube } from "./wave-2-youtube"
import { applyWave2Newsletter } from "./wave-2-newsletter"
import { applyWave2Podcast } from "./wave-2-podcast"
import { applyWave3B2b } from "./wave-3-b2b"
import { applyWave3Agency } from "./wave-3-agency"
import { applyWave3Cos } from "./wave-3-cos"
import { applyWave3Seo } from "./wave-3-seo"
import { applyWave4RealEstate } from "./wave-4-real-estate"
import { applyWave4Recruiter } from "./wave-4-recruiter"
import { applyWave4Medical } from "./wave-4-medical"
import { applyWave4Law } from "./wave-4-law"
import { applyWave4Home } from "./wave-4-home"
import type { SeedTemplate } from "./types"

export { TEMPLATE_SKILL_ATTACH, applySkillAttach } from "./skill-attach-map"
export { TEMPLATE_NAMED_FILES, applySharedFiles } from "./shared-file-manifests"
export { TEMPLATE_INTERVIEW_PACKS, applyInterviewSeed } from "./interview-packs"
export {
  TEMPLATE_MISSION_SCRIPTS,
  TEMPLATE_SPEC_CRONS,
  FORMERLY_EMPTY_TEMPLATE_SLUGS,
  applyMissionScripts,
} from "./mission-scripts"
export { applyWave0Twitter, TWITTER_WAVE0_SLUG } from "./wave-0-twitter"
export {
  applyWave1Freelancer,
  FREELANCER_WAVE1_SLUG,
  FREELANCER_HEARTBEAT_MD,
  FREELANCER_FIRST_MISSION_PROSE,
  INVOICE_ESCALATION_LADDER,
} from "./wave-1-freelancer"
export {
  applyWave1Quant,
  QUANT_WAVE1_SLUG,
  QUANT_HEARTBEAT_MD,
  QUANT_FIRST_MISSION_PROSE,
  INVENTED_BACKTEST_FIXTURE,
  DRAWDOWN_LADDER,
} from "./wave-1-quant"
export {
  applyWave1Ecom,
  ECOM_WAVE1_SLUG,
  ECOM_HEARTBEAT_MD,
  ECOM_FIRST_MISSION_PROSE,
  INVENTED_ROAS_FIXTURE,
  ROAS_PAUSE_RULE,
} from "./wave-1-ecom"
export {
  applyWave2Youtube,
  YOUTUBE_WAVE2_SLUG,
  YOUTUBE_HEARTBEAT_MD,
  YOUTUBE_FIRST_MISSION_PROSE,
  INVENTED_CTR_FIXTURE,
} from "./wave-2-youtube"
export {
  applyWave2Newsletter,
  NEWSLETTER_WAVE2_SLUG,
  NEWSLETTER_HEARTBEAT_MD,
  NEWSLETTER_FIRST_MISSION_PROSE,
  INVENTED_OPEN_RATE_FIXTURE,
} from "./wave-2-newsletter"
export {
  applyWave2Podcast,
  PODCAST_WAVE2_SLUG,
  PODCAST_HEARTBEAT_MD,
  PODCAST_FIRST_MISSION_PROSE,
  INVENTED_GUEST_FIXTURE,
} from "./wave-2-podcast"
export {
  applyWave3B2b,
  B2B_WAVE3_SLUG,
  B2B_HEARTBEAT_MD,
  B2B_FIRST_MISSION_PROSE,
} from "./wave-3-b2b"
export {
  applyWave3Agency,
  AGENCY_WAVE3_SLUG,
  AGENCY_HEARTBEAT_MD,
  AGENCY_FIRST_MISSION_PROSE,
} from "./wave-3-agency"
export {
  applyWave3Cos,
  COS_WAVE3_SLUG,
  COS_HEARTBEAT_MD,
  COS_FIRST_MISSION_PROSE,
  COS_CRITIC_KNOB,
} from "./wave-3-cos"
export {
  applyWave3Seo,
  SEO_WAVE3_SLUG,
  SEO_HEARTBEAT_MD,
  SEO_FIRST_MISSION_PROSE,
} from "./wave-3-seo"
export {
  applyWave4RealEstate,
  RE_WAVE4_SLUG,
  RE_HEARTBEAT_MD,
  RE_FIRST_MISSION_PROSE,
} from "./wave-4-real-estate"
export {
  applyWave4Recruiter,
  RECRUITER_WAVE4_SLUG,
  RECRUITER_HEARTBEAT_MD,
  RECRUITER_FIRST_MISSION_PROSE,
} from "./wave-4-recruiter"
export {
  applyWave4Medical,
  MEDICAL_WAVE4_SLUG,
  MEDICAL_HEARTBEAT_MD,
  MEDICAL_FIRST_MISSION_PROSE,
} from "./wave-4-medical"
export {
  applyWave4Law,
  LAW_WAVE4_SLUG,
  LAW_HEARTBEAT_MD,
  LAW_FIRST_MISSION_PROSE,
} from "./wave-4-law"
export {
  applyWave4Home,
  HOME_WAVE4_SLUG,
  HOME_HEARTBEAT_MD,
  HOME_FIRST_MISSION_PROSE,
} from "./wave-4-home"

export const ALL_TEMPLATES: SeedTemplate[] = [
  ...MONEY_MAKING_TEMPLATES,
  ...CREATOR_TEMPLATES,
  ...BUSINESS_OPS_TEMPLATES,
  ...VERTICAL_TEMPLATES,
  ...LIFESTYLE_TEMPLATES,
]
  .map(applySkillAttach)
  .map(applySharedFiles)
  .map(applyInterviewSeed)
  .map(applyMissionScripts)
  .map(applyWave0Twitter)
  .map(applyWave1Freelancer)
  .map(applyWave1Quant)
  .map(applyWave1Ecom)
  .map(applyWave2Youtube)
  .map(applyWave2Newsletter)
  .map(applyWave2Podcast)
  .map(applyWave3B2b)
  .map(applyWave3Agency)
  .map(applyWave3Cos)
  .map(applyWave3Seo)
  .map(applyWave4RealEstate)
  .map(applyWave4Recruiter)
  .map(applyWave4Medical)
  .map(applyWave4Law)
  .map(applyWave4Home)

const slugs = ALL_TEMPLATES.map((t) => t.slug)
const orders = ALL_TEMPLATES.map((t) => t.sortOrder)
if (new Set(slugs).size !== slugs.length) throw new Error("Duplicate template slugs detected")
if (new Set(orders).size !== orders.length) throw new Error("Duplicate sortOrders detected")
if (ALL_TEMPLATES.length !== 20) throw new Error(`Expected 20 templates, got ${ALL_TEMPLATES.length}`)

export type { SeedTemplate } from "./types"
