/**
 * ClawTemplate-only refresh (WIRE-FULL PR-3).
 *
 * Upserts the 20 official templates from prisma/seed-data — does NOT touch
 * skills, versions, or other seed tables. Preserves reviews/installs/purchases
 * (same upsert semantics as prisma/seed.ts).
 *
 * Staging:
 *   dotenv -e .env.staging -- npx tsx scripts/seed-claw-templates-only.ts
 *
 * Prod: founder card only — do not run this against production without explicit ACK.
 */
import dotenv from "dotenv"

if (!process.env.DATABASE_URL) {
  dotenv.config({ path: ".env.local" })
}

import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { ALL_TEMPLATES } from "../prisma/seed-data"
import { buildWorkspaceSnapshotFromSeedTemplate } from "../src/lib/marketplace/workspace-snapshot"

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" })
const prisma = new PrismaClient({ adapter })

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required")
  }
  console.log(`🌱 ClawTemplate-only upsert (${ALL_TEMPLATES.length} templates)…`)
  for (const template of ALL_TEMPLATES) {
    const workspaceSnapshot = buildWorkspaceSnapshotFromSeedTemplate(template)
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
    console.log(`  ✅ ${template.slug}`)
  }
  console.log("Done (reviews/installs/purchases preserved).")
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
