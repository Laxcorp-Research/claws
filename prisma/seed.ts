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

  // Upsert by slug (PR2.8a Task 0.6). Previous version called deleteMany() +
  // create() which cascade-deleted every TemplateReview + TemplateInstall row
  // (both FKs are ON DELETE CASCADE per prisma/migrations/20260321102737_init
  // and 20260326184130_marketplace_platform) — i.e. running seed on a
  // populated DB wiped every user-generated review and install of every seed
  // template. It also would have failed outright (Purchase.clawTemplateId is
  // ON DELETE RESTRICT) the moment a paid template had any Purchase row.
  //
  // Upsert preserves reviews, installs, purchases, and Workspace associations
  // while still propagating field changes (workspaceSnapshot, description,
  // tagline, etc.) to existing rows. Same class of fix PR #3a applied to
  // skills, confirmed by audit of every ON DELETE behaviour on ClawTemplate
  // FKs (Workspace SET NULL, TemplateReview CASCADE, TemplateInstall CASCADE,
  // Purchase RESTRICT, MarketplaceSale SET NULL).
  //
  // Templates dropped from ALL_TEMPLATES between seed runs are left untouched
  // in the DB (orphan rows). Cleanup of stale rows is a separate operator
  // step; doing it here without a whitelist of currently-expected slugs
  // would re-introduce the cascade-delete footgun.
  //
  // Mutation test (run manually on staging after modifying this file or
  // touching any ClawTemplate seed data):
  //   1. Pick any official ClawTemplate slug (e.g. 'youtube-channel-os').
  //   2. Insert a sentinel review tagged with title='MUTATION_TEST_SENTINEL':
  //        INSERT INTO "TemplateReview"
  //          (id, "clawTemplateId", "userId", rating, title,
  //           "verifiedInstall", "createdAt", "updatedAt")
  //        VALUES (
  //          'mutation-sentinel-' || substr(md5(random()::text), 1, 12),
  //          (SELECT id FROM "ClawTemplate" WHERE slug = 'youtube-channel-os'),
  //          (SELECT id FROM "User" LIMIT 1),
  //          5, 'MUTATION_TEST_SENTINEL', false, NOW(), NOW()
  //        );
  //   3. Run: DATABASE_URL=$STAGING_DATABASE_URL npx prisma db seed
  //   4. Verify:
  //        SELECT COUNT(*) FROM "TemplateReview"
  //          WHERE title = 'MUTATION_TEST_SENTINEL';
  //      Expect 1. If 0, the seed is destructive again — halt and investigate.
  //   5. Clean up:
  //        DELETE FROM "TemplateReview"
  //          WHERE title = 'MUTATION_TEST_SENTINEL';
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

    const data = {
      name: template.name,
      tagline: template.tagline,
      description: template.description,
      category: template.category,
      price: template.price,
      isFree: template.price === 0,
      agentCount: template.agentCount,
      featured: template.featured,
      sortOrder: template.sortOrder,
      isPublished: true,
      trustTier: "OFFICIAL" as const,
      reviewStatus: "APPROVED" as const,
      workspaceSnapshot,
    }

    await prisma.clawTemplate.upsert({
      where: { slug: template.slug },
      create: { slug: template.slug, ...data },
      update: data,
    })
    console.log(`  ✅ ${template.name}`)
  }

  console.log(`  Upserted ${ALL_TEMPLATES.length} Claw templates (non-destructive; existing reviews/installs/purchases preserved)\n`)

  // Upsert by slug (PR #3a). Previous version called deleteMany() + create(),
  // which cascade-deletes every AgentSkill row because Skill is the parent
  // in that FK relation — i.e. running seed on a populated DB wiped skill
  // assignments for every user. Upsert preserves agent->skill wiring and
  // still propagates field changes (skillMd, permissions, etc.) to existing
  // rows.
  //
  // Skills dropped from ALL_SKILLS between seed runs are left untouched in
  // the DB (orphan rows). Cleanup of stale rows is a separate operator step;
  // doing it here without a whitelist of currently-expected slugs would
  // re-introduce the cascade-delete footgun.
  const seedSkillSlugs = ALL_SKILLS.map((s) => s.slug)
  for (const skill of ALL_SKILLS) {
    const data = {
      name: skill.name,
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
      permissions: skill.permissions,
    }
    await prisma.skill.upsert({
      where: { slug: skill.slug },
      create: { ...data, slug: skill.slug, version: 1 },
      update: data,
    })
    console.log(`  ✅ Skill: ${skill.name}`)
  }

  console.log(`  Upserted ${seedSkillSlugs.length} skills (non-destructive; existing AgentSkill rows preserved)\n`)

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

  // PR2.8a Task 0.6: converted from deleteMany() + create() to upsert-by-version
  // for consistency with the ClawTemplate + Skill upsert patterns. OpenClawVersion
  // has no incoming FKs today (verified against prisma/schema.prisma — Workspace /
  // Skill / ClawTemplate all carry minOpenClawVersion as a plain String, not an
  // FK), so the old deleteMany was safe on its own, but upsert-by-version is
  // idempotent and safer as a default pattern. `releasedAt` only sets on create;
  // updates preserve the original release timestamp.
  const openClawVersionSeed = {
    isStable: true,
    isLatest: true,
    isSecurityPatch: false,
    dockerImage: "ghcr.io/laxcorp-research/openclaw-runtime:latest",
    releaseNotes: "Initial stable release for Claws platform launch.",
  }
  await prisma.openClawVersion.upsert({
    where: { version: "2.5.0" },
    create: { version: "2.5.0", ...openClawVersionSeed, releasedAt: new Date() },
    update: openClawVersionSeed,
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
