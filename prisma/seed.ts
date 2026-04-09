import dotenv from "dotenv"

if (!process.env.DATABASE_URL) {
  dotenv.config({ path: ".env.local" })
}

import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { ALL_TEMPLATES } from "./seed-data"
import { ALL_SKILLS } from "./seed-data/skills-index"
import { MARKETPLACE_SKILLS_CATALOG, generateSkillMd } from "./seed-data/marketplace-skills"

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" })
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log("🌱 Seeding Claws database...")

  await prisma.clawTemplate.deleteMany()
  console.log("  Cleared existing templates")

  for (const template of ALL_TEMPLATES) {
    const workspaceSnapshot = JSON.stringify({
      agents: template.agents.map((a) => ({
        name: a.name,
        agentSlug: a.agentSlug,
        role: a.role,
        color: a.color,
        model: a.model,
        roleDescription: a.roleDescription,
        soulMd: a.soulMd,
        agentsMd: a.agentsMd,
        heartbeatMd: a.heartbeatMd,
        skills: a.skills,
        positionX: a.position.x,
        positionY: a.position.y,
      })),
      connections: template.connections,
      tools: template.tools,
      flowDescription: template.flowDescription,
      legalDisclaimer: template.legalDisclaimer ?? null,
    })

    await prisma.clawTemplate.create({
      data: {
        name: template.name,
        slug: template.slug,
        tagline: template.tagline,
        description: template.description,
        category: template.category,
        price: template.price,
        isFree: template.price === 0,
        agentCount: template.agentCount,
        featured: template.featured,
        sortOrder: template.sortOrder,
        isPublished: true,
        trustTier: "OFFICIAL",
        reviewStatus: "APPROVED",
        workspaceSnapshot,
      },
    })
    console.log(`  ✅ ${template.name}`)
  }

  console.log(`  Seeded ${ALL_TEMPLATES.length} Claw templates\n`)

  await prisma.skill.deleteMany()
  console.log("  Cleared existing skills")

  for (const skill of ALL_SKILLS) {
    await prisma.skill.create({
      data: {
        name: skill.name,
        slug: skill.slug,
        description: skill.description,
        skillMd: skill.skillMd,
        type: skill.type,
        category: skill.category,
        icon: skill.icon,
        compatibleTools: skill.compatibleTools,
        requiresToolConnection: skill.requiresToolConnection,
        requiredToolCategory: skill.requiredToolCategory ?? null,
        isVerified: true,
        isBuiltIn: skill.isBuiltIn,
        isCurated: true,
        version: 1,
        permissions: skill.permissions,
      },
    })
    console.log(`  ✅ Skill: ${skill.name}`)
  }

  console.log(`  Seeded ${ALL_SKILLS.length} skills\n`)

  const seedSlugs = MARKETPLACE_SKILLS_CATALOG.map(s => s.slug)
  await prisma.skillReview.deleteMany({ where: { skill: { slug: { in: seedSlugs } } } })
  await prisma.skillInstall.deleteMany({ where: { skill: { slug: { in: seedSlugs } } } })
  await prisma.marketplaceSkill.deleteMany({ where: { slug: { in: seedSlugs } } })
  console.log(`  Cleared ${seedSlugs.length} seed marketplace skills (preserved ClawHub)`)

  for (const skill of MARKETPLACE_SKILLS_CATALOG) {
    await prisma.marketplaceSkill.upsert({
      where: { slug: skill.slug },
      update: {
        name: skill.name,
        description: skill.description,
        category: skill.category,
        tags: skill.tags,
        emoji: skill.emoji,
        skillMd: generateSkillMd(skill),
        requiredBins: skill.requiredBins,
        requiredEnvVars: skill.requiredEnvVars,
        trustTier: skill.trustTier,
        reviewStatus: "APPROVED",
        isPublished: true,
        isFree: true,
        price: null,
        installCount: 0,
      },
      create: {
        slug: skill.slug,
        name: skill.name,
        description: skill.description,
        category: skill.category,
        tags: skill.tags,
        emoji: skill.emoji,
        skillMd: generateSkillMd(skill),
        requiredBins: skill.requiredBins,
        requiredEnvVars: skill.requiredEnvVars,
        trustTier: skill.trustTier,
        reviewStatus: "APPROVED",
        isPublished: true,
        isFree: true,
        price: null,
        autoScanPassed: true,
        autoScanReport: JSON.stringify({ findings: [], passed: true }),
        publishedAt: new Date(),
        creatorId: null,
        installCount: 0,
      },
    })
    console.log(`  ✅ MktSkill: ${skill.name}`)
  }

  console.log(`  Seeded ${MARKETPLACE_SKILLS_CATALOG.length} marketplace skills\n`)

  await prisma.openClawVersion.deleteMany()
  console.log("  Cleared existing OpenClaw versions")

  await prisma.openClawVersion.create({
    data: {
      version: "2.5.0",
      isStable: true,
      isLatest: true,
      isSecurityPatch: false,
      dockerImage: "ghcr.io/laxcorp/openclaw-runtime:latest",
      releaseNotes: "Initial stable release for Claws platform launch.",
      releasedAt: new Date(),
    },
  })
  console.log("  ✅ OpenClawVersion: 2.5.0 (stable)")

  console.log(`\n🎉 Seeded ${ALL_TEMPLATES.length} templates + ${ALL_SKILLS.length} skills + ${MARKETPLACE_SKILLS_CATALOG.length} marketplace skills + 1 OpenClaw version`)
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
