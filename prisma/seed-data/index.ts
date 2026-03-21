import { MONEY_MAKING_TEMPLATES } from "./money-making-templates"
import { CREATOR_TEMPLATES } from "./creator-templates"
import { BUSINESS_OPS_TEMPLATES } from "./business-ops-templates"
import { VERTICAL_TEMPLATES } from "./vertical-templates"
import { LIFESTYLE_TEMPLATES } from "./lifestyle-templates"
import type { SeedTemplate } from "./types"

export const ALL_TEMPLATES: SeedTemplate[] = [
  ...MONEY_MAKING_TEMPLATES,
  ...CREATOR_TEMPLATES,
  ...BUSINESS_OPS_TEMPLATES,
  ...VERTICAL_TEMPLATES,
  ...LIFESTYLE_TEMPLATES,
]

const slugs = ALL_TEMPLATES.map((t) => t.slug)
const orders = ALL_TEMPLATES.map((t) => t.sortOrder)
if (new Set(slugs).size !== slugs.length) throw new Error("Duplicate template slugs detected")
if (new Set(orders).size !== orders.length) throw new Error("Duplicate sortOrders detected")
if (ALL_TEMPLATES.length !== 20) throw new Error(`Expected 20 templates, got ${ALL_TEMPLATES.length}`)

export type { SeedTemplate } from "./types"
