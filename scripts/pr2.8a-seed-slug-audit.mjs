// PR2.8a Task 5 — verify every slug referenced by any prisma/seed-data/*.ts
// tool entry (or nested alternative) exists in the current ALL_TOOL_SLUGS
// from tool-catalog.ts. Prints a drift report; exit code 1 if any drift found.
//
// Run: node scripts/pr2.8a-seed-slug-audit.mjs
//
// Parses source files as text (no tsx runtime) to avoid loading
// src/generated/prisma which depends on DATABASE_URL. Target: quick sanity
// check, not a production tool.

import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

// Parse ALL_TOOL_SLUGS from tool-catalog.ts by extracting the first `as const`
// array literal whose heading line contains ALL_TOOL_SLUGS.
const catalogSrc = readFileSync('src/data/tool-catalog.ts', 'utf8')
const slugListMatch = catalogSrc.match(
  /export const ALL_TOOL_SLUGS\s*=\s*\[([\s\S]*?)\]\s*as const/,
)
if (!slugListMatch) {
  console.error('FATAL: could not locate ALL_TOOL_SLUGS declaration in tool-catalog.ts')
  process.exit(2)
}
const catalogSlugs = new Set(
  Array.from(slugListMatch[1].matchAll(/"([^"]+)"/g)).map((m) => m[1]),
)
console.log(`[catalog] ALL_TOOL_SLUGS loaded: ${catalogSlugs.size} entries`)

// Seed template files (5 in prisma/seed-data/)
const seedDir = 'prisma/seed-data'
const templateFiles = readdirSync(seedDir)
  .filter((f) => f.endsWith('-templates.ts'))
  .map((f) => path.join(seedDir, f))

const drifts = []
let toolEntryCount = 0
let alternativeCount = 0

for (const file of templateFiles) {
  const src = readFileSync(file, 'utf8')

  // Every SeedTool literal: `{ slug: "...", ... }` inside tools arrays.
  // Match the slug + name + any alternatives array inside the same object.
  const toolRe = /\{\s*slug:\s*"([^"]+)"\s*,\s*name:\s*"([^"]+)"[\s\S]*?\}/g
  let m
  while ((m = toolRe.exec(src)) !== null) {
    toolEntryCount++
    const slug = m[1]
    const name = m[2]
    // Skip nested object literals that aren't tool entries — heuristic: a
    // tool entry always has `connectionType` within the same literal. The
    // match's [0] contains the full object body up to the first `}`; check.
    if (!/connectionType:\s*"(API_KEY|OAUTH_COMPOSIO)"/.test(m[0])) continue
    if (!catalogSlugs.has(slug)) {
      drifts.push({
        file: path.basename(file),
        line: src.slice(0, m.index).split('\n').length,
        slug,
        name,
        kind: 'primary',
      })
    }
    // alternatives: [slug1, slug2, ...]
    const altMatch = m[0].match(/alternatives:\s*\[([^\]]+)\]/)
    if (altMatch) {
      for (const altQuote of altMatch[1].matchAll(/"([^"]+)"/g)) {
        alternativeCount++
        const altSlug = altQuote[1]
        if (!catalogSlugs.has(altSlug)) {
          drifts.push({
            file: path.basename(file),
            line: src.slice(0, m.index).split('\n').length,
            slug: altSlug,
            parent: slug,
            kind: 'alternative',
          })
        }
      }
    }
  }
}

console.log(
  `[seeds] scanned ${templateFiles.length} template files, ${toolEntryCount} tool entries, ${alternativeCount} alternative slugs`,
)

if (drifts.length === 0) {
  console.log('\n✓ No slug drift detected. All seed references resolve in ALL_TOOL_SLUGS.')
  process.exit(0)
}

console.log(`\n✗ ${drifts.length} drift(s) found:\n`)
for (const d of drifts) {
  if (d.kind === 'primary') {
    console.log(`  ${d.file}:${d.line}  "${d.slug}"  (name="${d.name}")  — not in catalog`)
  } else {
    console.log(`  ${d.file}:${d.line}  "${d.slug}"  (alt of "${d.parent}")  — not in catalog`)
  }
}
console.log(`\nRun this script again after fixing each drift until output is clean.`)
process.exit(1)
