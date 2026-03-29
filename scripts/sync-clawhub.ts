import dotenv from "dotenv"
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: ".env.local" })
}

import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { parse as parseYaml } from "yaml"

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" })
const prisma = new PrismaClient({ adapter })

const VOLTAGEN_BASE = "https://raw.githubusercontent.com/VoltAgent/awesome-openclaw-skills/main"
const ARCHIVE_BASE = "https://raw.githubusercontent.com/openclaw/skills/main/skills"

const CATEGORY_FILES = [
  "ai-and-llms",
  "apple-apps-and-services",
  "browser-and-automation",
  "calendar-and-scheduling",
  "clawdbot-tools",
  "cli-utilities",
  "coding-agents-and-ides",
  "communication",
  "data-and-analytics",
  "devops-and-cloud",
  "gaming",
  "git-and-github",
  "health-and-fitness",
  "image-and-video-generation",
  "ios-and-macos-development",
  "marketing-and-sales",
  "media-and-streaming",
  "moltbook",
  "notes-and-pkm",
  "pdf-and-documents",
  "personal-development",
  "productivity-and-tasks",
  "search-and-research",
  "security-and-passwords",
  "self-hosted-and-automation",
  "shopping-and-e-commerce",
  "smart-home-and-iot",
  "speech-and-transcription",
  "transportation",
  "web-and-frontend-development",
]

const CATEGORY_MAP: Record<string, string> = {
  "ai-and-llms": "Developer",
  "apple-apps-and-services": "System",
  "browser-and-automation": "Web",
  "calendar-and-scheduling": "Productivity",
  "clawdbot-tools": "System",
  "cli-utilities": "System",
  "coding-agents-and-ides": "Developer",
  "communication": "Communication",
  "data-and-analytics": "Data",
  "devops-and-cloud": "System",
  "gaming": "Data",
  "git-and-github": "Developer",
  "health-and-fitness": "Data",
  "image-and-video-generation": "Marketing",
  "ios-and-macos-development": "Developer",
  "marketing-and-sales": "Marketing",
  "media-and-streaming": "Marketing",
  "moltbook": "Developer",
  "notes-and-pkm": "Productivity",
  "pdf-and-documents": "Productivity",
  "personal-development": "Productivity",
  "productivity-and-tasks": "Productivity",
  "search-and-research": "Search",
  "security-and-passwords": "Security",
  "self-hosted-and-automation": "System",
  "shopping-and-e-commerce": "Finance",
  "smart-home-and-iot": "System",
  "speech-and-transcription": "Communication",
  "transportation": "Data",
  "web-and-frontend-development": "Developer",
}

interface VoltEntry {
  skillName: string
  urlSlug: string
  author: string
  description: string
  voltCategory: string
}

interface SkillFrontmatter {
  name?: string
  description?: string
  metadata?: string | { openclaw?: { emoji?: string; requires?: { env?: string[]; bins?: string[] } } }
  homepage?: string
}

const CRITICAL_PATTERNS = [
  /curl.*\$\{?[A-Z_]*KEY/i,
  /curl.*\$\{?[A-Z_]*TOKEN/i,
  /curl.*\$\{?[A-Z_]*SECRET/i,
  /wget.*\$\{?[A-Z_]*KEY/i,
  /base64\s+(encode|decode)/i,
  /eval\s*\(/,
  /\/etc\/shadow/,
  /\/root\//,
  /~\/.ssh/,
  /\.env(?!\s*var)/i,
  /\/home\/node\/\.openclaw\/(?!skills)/,
]

function quickScan(content: string): boolean {
  return !CRITICAL_PATTERNS.some(p => p.test(content))
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

const headers: Record<string, string> = {
  "User-Agent": "laxclaws-sync/1.0",
}
if (process.env.GITHUB_TOKEN) {
  headers["Authorization"] = `token ${process.env.GITHUB_TOKEN}`
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers })
    if (!res.ok) return null
    return res.text()
  } catch {
    return null
  }
}

function parseCategoryFile(content: string, categoryName: string): VoltEntry[] {
  const entries: VoltEntry[] = []
  for (const line of content.split("\n")) {
    const match = line.match(/^-\s+\[([^\]]+)\]\(https?:\/\/clawskills\.sh\/skills\/([^)]+)\)\s*-\s*(.+)$/)
    if (!match) continue
    const [, skillName, urlSlug, description] = match
    const cleanSlug = urlSlug.trim()
    const dashIdx = cleanSlug.lastIndexOf("-" + skillName.trim())
    const author = dashIdx > 0 ? cleanSlug.slice(0, dashIdx) : cleanSlug.split("-")[0]
    entries.push({
      skillName: skillName.trim(),
      urlSlug: cleanSlug,
      author,
      description: description.trim().slice(0, 500),
      voltCategory: categoryName,
    })
  }
  return entries
}

function parseFrontmatter(skillMd: string): { fm: SkillFrontmatter; body: string } {
  const match = skillMd.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (!match) return { fm: {}, body: skillMd }
  try {
    const fm = parseYaml(match[1]) as SkillFrontmatter
    return { fm, body: match[2] }
  } catch {
    return { fm: {}, body: skillMd }
  }
}

function extractOpenClaw(fm: SkillFrontmatter): { emoji: string | null; envVars: string[]; bins: string[] } {
  let meta = fm.metadata
  if (typeof meta === "string") {
    try { meta = JSON.parse(meta) } catch { return { emoji: null, envVars: [], bins: [] } }
  }
  if (!meta || typeof meta !== "object") return { emoji: null, envVars: [], bins: [] }
  const oc = (meta as { openclaw?: { emoji?: string; requires?: { env?: string[]; bins?: string[] } } }).openclaw
  if (!oc) return { emoji: null, envVars: [], bins: [] }
  return {
    emoji: oc.emoji ?? null,
    envVars: Array.isArray(oc.requires?.env) ? oc.requires.env : [],
    bins: Array.isArray(oc.requires?.bins) ? oc.requires.bins : [],
  }
}

function normalizeSlug(entry: VoltEntry): string {
  return entry.urlSlug
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100)
}

async function main() {
  console.log("=== ClawHub Skills Sync ===\n")
  const start = Date.now()

  const stats = {
    categoriesParsed: 0,
    entriesFound: 0,
    uniqueEntries: 0,
    skillMdFetched: 0,
    skillMdMissing: 0,
    scanPassed: 0,
    scanFailed: 0,
    officialCollision: 0,
    duplicateSlug: 0,
    upserted: 0,
  }

  // 1. Fetch and parse all category files
  console.log("Fetching VoltAgent category files...")
  const allEntries: VoltEntry[] = []

  for (const cat of CATEGORY_FILES) {
    const content = await fetchText(`${VOLTAGEN_BASE}/categories/${cat}.md`)
    if (!content) { console.log(`  SKIP ${cat} (fetch failed)`); continue }
    const entries = parseCategoryFile(content, cat)
    allEntries.push(...entries)
    stats.categoriesParsed++
    console.log(`  ${cat}: ${entries.length} skills`)
    await delay(50)
  }
  stats.entriesFound = allEntries.length
  console.log(`\nTotal entries: ${allEntries.length}`)

  // 2. Deduplicate by normalized slug
  const seen = new Set<string>()
  const uniqueEntries = allEntries.filter(e => {
    const slug = normalizeSlug(e)
    if (seen.has(slug)) { stats.duplicateSlug++; return false }
    seen.add(slug)
    return true
  })
  stats.uniqueEntries = uniqueEntries.length
  console.log(`Unique after dedup: ${uniqueEntries.length} (${stats.duplicateSlug} dupes removed)\n`)

  // 3. Get existing Official slugs to protect
  const officialSlugs = new Set(
    (await prisma.marketplaceSkill.findMany({
      where: { trustTier: "OFFICIAL" },
      select: { slug: true },
    })).map(s => s.slug)
  )
  console.log(`Protecting ${officialSlugs.size} OFFICIAL skills\n`)

  // 4. Fetch SKILL.md, scan, and collect
  console.log("Fetching SKILL.md files from archive...")
  const toUpsert: Array<Record<string, unknown>> = []

  for (let i = 0; i < uniqueEntries.length; i++) {
    const entry = uniqueEntries[i]
    const slug = normalizeSlug(entry)

    if (officialSlugs.has(slug)) { stats.officialCollision++; continue }

    const skillMd = await fetchText(`${ARCHIVE_BASE}/${entry.author}/${entry.skillName}/SKILL.md`)
    if (!skillMd) { stats.skillMdMissing++; await delay(30); continue }
    stats.skillMdFetched++

    if (!quickScan(skillMd)) { stats.scanFailed++; continue }
    stats.scanPassed++

    const { fm } = parseFrontmatter(skillMd)
    const oc = extractOpenClaw(fm)

    toUpsert.push({
      slug,
      name: (fm.name || entry.skillName).slice(0, 200),
      description: (fm.description || entry.description).slice(0, 500),
      category: CATEGORY_MAP[entry.voltCategory] || "System",
      tags: [entry.voltCategory],
      emoji: oc.emoji,
      skillMd,
      requiredBins: oc.bins,
      requiredEnvVars: oc.envVars,
      trustTier: "SCANNED",
      reviewStatus: "APPROVED",
      isPublished: true,
      isFree: true,
      price: null,
      autoScanPassed: true,
      autoScanReport: JSON.stringify({ source: "clawhub-sync", passed: true }),
      publishedAt: new Date(),
      creatorId: null,
      installCount: 0,
    })

    if ((i + 1) % 200 === 0) {
      console.log(`  Processed ${i + 1}/${uniqueEntries.length} (${toUpsert.length} ready, ${stats.skillMdMissing} missing, ${stats.scanFailed} scan-failed)`)
    }
    await delay(80)
  }

  console.log(`\nReady to upsert: ${toUpsert.length}`)

  // 5. Individual upserts (no transaction — Neon pooler can't handle large batched transactions)
  for (let i = 0; i < toUpsert.length; i++) {
    const s = toUpsert[i]
    try {
      await prisma.marketplaceSkill.upsert({
        where: { slug: s.slug as string },
        create: s as never,
        update: {
          name: s.name,
          description: s.description,
          category: s.category,
          skillMd: s.skillMd,
          emoji: s.emoji,
          requiredBins: s.requiredBins,
          requiredEnvVars: s.requiredEnvVars,
          autoScanPassed: s.autoScanPassed,
          autoScanReport: s.autoScanReport,
        } as never,
      })
    } catch (e) {
      console.log(`  SKIP upsert ${s.slug}: ${(e as Error).message?.slice(0, 80)}`)
    }
    if ((i + 1) % 200 === 0) {
      console.log(`  Upserted ${i + 1}/${toUpsert.length}`)
    }
  }
  stats.upserted = toUpsert.length

  const elapsed = ((Date.now() - start) / 1000 / 60).toFixed(1)

  console.log("\n=== SYNC COMPLETE ===")
  console.log(JSON.stringify(stats, null, 2))
  console.log(`Runtime: ${elapsed} minutes`)

  const total = await prisma.marketplaceSkill.count()
  console.log(`Total MarketplaceSkill records: ${total}`)

  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
