import { MONEY_MAKING_TEMPLATES } from "./money-making-templates"
import { CREATOR_TEMPLATES } from "./creator-templates"
import { BUSINESS_OPS_TEMPLATES } from "./business-ops-templates"
import { VERTICAL_TEMPLATES } from "./vertical-templates"
import { LIFESTYLE_TEMPLATES } from "./lifestyle-templates"
import { applySkillAttach } from "./skill-attach-map"
import { applySharedFiles } from "./shared-file-manifests"
import { applyInterviewSeed } from "./interview-packs"
import { applyMissionScripts } from "./mission-scripts"
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

const slugs = ALL_TEMPLATES.map((t) => t.slug)
const orders = ALL_TEMPLATES.map((t) => t.sortOrder)
if (new Set(slugs).size !== slugs.length) throw new Error("Duplicate template slugs detected")
if (new Set(orders).size !== orders.length) throw new Error("Duplicate sortOrders detected")
if (ALL_TEMPLATES.length !== 20) throw new Error(`Expected 20 templates, got ${ALL_TEMPLATES.length}`)

export type { SeedTemplate } from "./types"
