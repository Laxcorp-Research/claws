/**
 * One-off / ops: verify FTS columns and sample queries.
 * Usage: npx dotenv -e .env.staging -- npx tsx scripts/verify-marketplace-fts.ts
 */
import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

const url = process.env.DATABASE_URL
if (!url) {
  console.error("DATABASE_URL is not set")
  process.exit(1)
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url }),
})

async function main() {
  const templateCol = await prisma.$queryRawUnsafe<
    Array<{ column_name: string; data_type: string }>
  >(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'ClawTemplate' AND column_name = 'searchVector'
  `)
  console.log("ClawTemplate.searchVector:", templateCol)

  const skillCol = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'MarketplaceSkill' AND column_name = 'searchVector'
  `)
  console.log("MarketplaceSkill.searchVector:", skillCol)

  const templateIdx = await prisma.$queryRawUnsafe<Array<{ indexname: string }>>(`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'ClawTemplate' AND indexname LIKE '%search%'
  `)
  console.log("ClawTemplate search indexes:", templateIdx)

  const skillIdx = await prisma.$queryRawUnsafe<Array<{ indexname: string }>>(`
    SELECT indexname FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'MarketplaceSkill' AND indexname LIKE '%search%'
  `)
  console.log("MarketplaceSkill search indexes:", skillIdx)

  const quant = await prisma.$queryRawUnsafe<Array<{ id: string; name: string }>>(`
    SELECT "id", "name"
    FROM "ClawTemplate"
    WHERE "isPublished" = true
      AND "searchVector" @@ to_tsquery('english', 'quant:*')
    LIMIT 5
  `)
  console.log('Search "quant:*":', quant)

  const sales = await prisma.$queryRawUnsafe<Array<{ id: string; name: string }>>(`
    SELECT "id", "name"
    FROM "ClawTemplate"
    WHERE "isPublished" = true
      AND "searchVector" @@ to_tsquery('english', 'sales:*')
    LIMIT 5
  `)
  console.log('Search "sales:*":', sales)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
