// PR2.8a Task 12 — trace the wizard resolver's output for two target
// templates without spinning up a browser. Mirrors the resolver logic in
// src/app/setup/[workspaceId]/step/[n]/page.tsx (buildToolState section)
// against the same template.tools array the API route would serve from
// workspaceSnapshot. Prints the resolved ToolState rows + any comingSoon
// filter drops so operator can spot-check against the live wizard after
// deploy.
//
// Run: node scripts/archive/pr2.8a-wizard-parity-trace.mjs
// (reads source files; no DB or network dependency.)

import { readFileSync } from 'node:fs'

// Pull ALL_TOOLS literally from the catalog file to avoid importing TS.
function parseCatalog() {
  const src = readFileSync('src/data/tool-catalog.ts', 'utf8')
  const entries = []
  // Match a flat single-line tool entry
  //   { slug: "x", name: "...", connectionType: "...", category: "...", ..., credentialFields: [...] },
  // And skip entries that span multiple lines (coinbase, twilio, binance, etc. —
  // their slug/name live on their own lines; those aren't in our target
  // templates anyway except via substring names, so the one-liner filter is
  // sufficient for this parity trace's purposes).
  const lineRe = /\{\s*slug:\s*"([^"]+)".*?\}/g
  let m
  while ((m = lineRe.exec(src)) !== null) {
    const blob = m[0]
    const slug = m[1]
    const name = (blob.match(/name:\s*"([^"]+)"/) ?? [])[1] ?? slug
    const connectionType = (blob.match(/connectionType:\s*"([^"]+)"/) ?? [])[1]
    const category = (blob.match(/category:\s*"([^"]+)"/) ?? [])[1]
    const isAIProvider = /isAIProvider:\s*true/.test(blob)
    const comingSoon = /comingSoon:\s*true/.test(blob)
    const deprecated = /deprecated:\s*true/.test(blob)
    entries.push({ slug, name, connectionType, category, isAIProvider, comingSoon, deprecated })
  }
  // Also grab multi-line entries (coinbase, twilio, binance, alpaca, etc.) by a
  // different regex — they use `slug: "X",\n ... credentialFields: [\n...] }`.
  const multiRe = /\{\s*\n\s*slug:\s*"([^"]+)"[\s\S]*?credentialFields:[\s\S]*?\]\s*,?\s*\}/g
  while ((m = multiRe.exec(src)) !== null) {
    const blob = m[0]
    const slug = m[1]
    if (entries.some((e) => e.slug === slug)) continue
    const name = (blob.match(/name:\s*"([^"]+)"/) ?? [])[1] ?? slug
    const connectionType = (blob.match(/connectionType:\s*"([^"]+)"/) ?? [])[1]
    const category = (blob.match(/category:\s*"([^"]+)"/) ?? [])[1]
    const isAIProvider = /isAIProvider:\s*true/.test(blob)
    const comingSoon = /comingSoon:\s*true/.test(blob)
    const deprecated = /deprecated:\s*true/.test(blob)
    entries.push({ slug, name, connectionType, category, isAIProvider, comingSoon, deprecated })
  }
  return new Map(entries.map((e) => [e.slug, e]))
}

function parseTemplateTools(file, templateSlug) {
  const src = readFileSync(file, 'utf8')
  // Find "slug: \"<templateSlug>\"" and then the next tools: [...] block.
  const slugIdx = src.indexOf(`slug: "${templateSlug}"`)
  if (slugIdx < 0) return null
  const toolsIdx = src.indexOf('tools: [', slugIdx)
  const toolsEnd = src.indexOf('],', toolsIdx)
  if (toolsIdx < 0 || toolsEnd < 0) return null
  const block = src.slice(toolsIdx, toolsEnd + 2)
  const entries = []
  const toolRe = /\{\s*slug:\s*"([^"]+)"[^}]*\}/g
  let m
  while ((m = toolRe.exec(block)) !== null) {
    const blob = m[0]
    const slug = m[1]
    const name = (blob.match(/name:\s*"([^"]+)"/) ?? [])[1]
    const required = /required:\s*true/.test(blob)
    const altMatch = blob.match(/alternatives:\s*\[([^\]]+)\]/)
    const alternatives = altMatch
      ? Array.from(altMatch[1].matchAll(/"([^"]+)"/g)).map((a) => a[1])
      : []
    entries.push({ slug, name, required, alternatives })
  }
  return entries
}

const catalog = parseCatalog()

function resolveOneOf(entry, existingConnections = []) {
  const candidates = [entry.slug, ...(entry.alternatives ?? [])]
  for (const s of candidates) {
    if (existingConnections.includes(s)) return { slug: s, def: catalog.get(s) }
  }
  for (const s of candidates) {
    const d = catalog.get(s)
    if (d && !d.comingSoon) return { slug: s, def: d }
  }
  return { slug: entry.slug, def: catalog.get(entry.slug) }
}

function traceTemplate(file, templateSlug, label) {
  const entries = parseTemplateTools(file, templateSlug)
  if (!entries) {
    console.log(`[${label}] FAIL — template ${templateSlug} not found in ${file}`)
    return
  }
  console.log(`\n=== ${label} — template ${templateSlug} ===`)
  const filtered = []
  const rendered = []
  for (const entry of entries) {
    const { slug: chosen, def } = resolveOneOf(entry)
    if (!def) {
      console.log(`  UNRESOLVED: ${entry.slug} (alternatives: ${entry.alternatives.join(', ')})`)
      continue
    }
    if (def.comingSoon) {
      filtered.push({ entry, chosen, reason: 'all candidates comingSoon' })
      continue
    }
    if (def.isAIProvider) {
      filtered.push({ entry, chosen, reason: 'AI provider — handled on Step 1' })
      continue
    }
    rendered.push({ entry, chosen, def })
  }

  console.log(`\n  Rendered in wizard Step 2 (${rendered.length}):`)
  for (const r of rendered) {
    const reqBadge = r.entry.required ? 'REQUIRED' : 'recommended'
    const altNote = r.entry.alternatives.length > 0 ? ` (oneOf: ${r.entry.alternatives.join(', ')})` : ''
    console.log(`    [${reqBadge}] ${r.chosen}${altNote}  — ${r.def.name} (${r.def.connectionType})`)
  }

  if (filtered.length > 0) {
    console.log(`\n  Filtered out (${filtered.length}):`)
    for (const f of filtered) {
      console.log(`    ${f.entry.slug} — ${f.reason}`)
    }
  }
}

traceTemplate('prisma/seed-data/creator-templates.ts', 'twitter-growth-machine', 'Twitter/X Growth Machine')
traceTemplate('prisma/seed-data/business-ops-templates.ts', 'founders-chief-of-staff', "Founder's Chief of Staff")
