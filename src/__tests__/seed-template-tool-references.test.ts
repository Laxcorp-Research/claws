// PR2.8a Task 9: seed template → tool catalog resolution contract.
//
// Three invariants enforced:
//
//   1. Every `tool.slug` and every `tool.alternatives[]` entry in every
//      seed template file resolves to a real catalog entry in ALL_TOOLS.
//      Post-PR2.8a Task 5 reconciliation + `scripts/pr2.8a-seed-slug-audit.mjs`
//      green, this is always true at commit time; the test locks it.
//
//   2. A plain (non-`alternatives`) required tool entry must NOT point at
//      a `comingSoon: true` catalog entry. Hard rule — if it were
//      `comingSoon`, the wizard resolver would filter it out and the
//      template would be un-deployable today.
//
//   3. A required tool entry WITH `alternatives` can have its primary or
//      individual alternatives flagged `comingSoon`, as long as at least
//      one slug in the oneOf set `[slug, ...alternatives]` resolves to a
//      non-`comingSoon` catalog entry. This preserves typed references to
//      PR2.8c placeholders (e.g. `amazon_sp_api` inside the E-Commerce
//      template's `shopify` alternatives) while guaranteeing every template
//      is deployable today via the non-`comingSoon` option.
//
// Recommended tool entries (required=false) have no comingSoon constraint;
// the wizard filter simply hides them from render until their PR2.8c
// integration ships.

import { describe, it, expect } from "vitest"
import { ALL_TOOLS, getToolBySlug } from "@/data/tool-catalog"
import { ALL_TEMPLATES } from "../../prisma/seed-data"
import type { SeedTool } from "../../prisma/seed-data/types"

const catalogSlugs = new Set(ALL_TOOLS.map((t) => t.slug))

describe("seed template tool references (PR2.8a Task 9)", () => {
  it("every seed tool.slug resolves in ALL_TOOLS", () => {
    const unresolved: Array<{ template: string; slug: string }> = []
    for (const tmpl of ALL_TEMPLATES) {
      for (const tool of tmpl.tools) {
        if (!catalogSlugs.has(tool.slug)) {
          unresolved.push({ template: tmpl.slug, slug: tool.slug })
        }
      }
    }
    expect(
      unresolved,
      `Seed tool.slug not in ALL_TOOLS:\n${unresolved
        .map((u) => `  ${u.template} -> "${u.slug}"`)
        .join("\n")}`,
    ).toEqual([])
  })

  it("every seed tool.alternatives[] entry resolves in ALL_TOOLS", () => {
    const unresolved: Array<{ template: string; parent: string; alt: string }> = []
    for (const tmpl of ALL_TEMPLATES) {
      for (const tool of tmpl.tools) {
        for (const alt of tool.alternatives ?? []) {
          if (!catalogSlugs.has(alt)) {
            unresolved.push({ template: tmpl.slug, parent: tool.slug, alt })
          }
        }
      }
    }
    expect(
      unresolved,
      `Seed tool.alternatives references unknown slug:\n${unresolved
        .map((u) => `  ${u.template} -> "${u.parent}" alt "${u.alt}"`)
        .join("\n")}`,
    ).toEqual([])
  })

  it("every required tool entry is deployable today (at least one non-comingSoon slug in its oneOf set)", () => {
    const undeployable: Array<{ template: string; entry: SeedTool; reason: string }> = []
    for (const tmpl of ALL_TEMPLATES) {
      for (const tool of tmpl.tools) {
        if (!tool.required) continue
        const candidates = [tool.slug, ...(tool.alternatives ?? [])]
        const primaryDef = getToolBySlug(tool.slug)

        // Plain required entry (no alternatives): slug itself must not be comingSoon.
        if (!tool.alternatives || tool.alternatives.length === 0) {
          if (primaryDef?.comingSoon) {
            undeployable.push({
              template: tmpl.slug,
              entry: tool,
              reason: `plain required slug "${tool.slug}" is comingSoon — template un-deployable today`,
            })
          }
          continue
        }

        // oneOf required entry: at least one candidate must resolve to a
        // non-comingSoon catalog entry.
        const anyDeployable = candidates.some((s) => {
          const def = getToolBySlug(s)
          return def && !def.comingSoon
        })
        if (!anyDeployable) {
          undeployable.push({
            template: tmpl.slug,
            entry: tool,
            reason: `all ${candidates.length} candidates (${candidates.join(", ")}) are comingSoon`,
          })
        }
      }
    }
    expect(
      undeployable,
      `Required tool entries have no deployable option:\n${undeployable
        .map((u) => `  ${u.template}: ${u.reason}`)
        .join("\n")}`,
    ).toEqual([])
  })

  it("no seed tool entry points at a deprecated catalog slug", () => {
    // Complement to the above: deprecated entries stay in the catalog only
    // to preserve historical ToolConnection rows; templates must not create
    // new references to them. Post-PR2.8a the only deprecated slug is
    // `youtube-data-api`; every template that used it was migrated to
    // `youtube` (Task 6).
    const references: Array<{ template: string; slug: string }> = []
    for (const tmpl of ALL_TEMPLATES) {
      for (const tool of tmpl.tools) {
        const candidates = [tool.slug, ...(tool.alternatives ?? [])]
        for (const s of candidates) {
          const def = getToolBySlug(s)
          if (def?.deprecated) references.push({ template: tmpl.slug, slug: s })
        }
      }
    }
    expect(
      references,
      `Seed templates reference deprecated catalog slugs:\n${references
        .map((r) => `  ${r.template} -> "${r.slug}"`)
        .join("\n")}`,
    ).toEqual([])
  })
})
