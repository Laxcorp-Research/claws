import { prisma } from "@/lib/db"

const RENAMES: Array<[string, string]> = [
  ["twitter_api", "twitter-api"],
  ["youtube_data", "youtube-data-api"],
  ["gsc", "google-search-console"],
  ["google_analytics", "google-analytics"],
]

async function main() {
  console.log("rename-drifted-slugs: starting")

  for (const [from, to] of RENAMES) {
    const tc = await prisma.toolConnection.updateMany({
      where: { toolSlug: from },
      data: { toolSlug: to },
    })
    const ms = await prisma.marketplaceSkill.updateMany({
      where: { slug: from },
      data: { slug: to },
    })
    console.log(`  ${from.padEnd(20)} -> ${to.padEnd(28)}  ToolConnection: ${tc.count}  MarketplaceSkill: ${ms.count}`)
  }

  console.log("rename-drifted-slugs: done")
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
