import { prisma } from "@/lib/db"
import { ApiKeySource } from "@/generated/prisma/client"

async function main() {
  const usersWithKeys = await prisma.userApiKey.findMany({
    select: { userId: true },
    distinct: ["userId"],
  })

  const userIdsWithKeys = usersWithKeys.map((u) => u.userId)

  if (userIdsWithKeys.length > 0) {
    await prisma.user.updateMany({
      where: { id: { in: userIdsWithKeys } },
      data: { apiKeySource: ApiKeySource.USER_OWN_KEY },
    })
  }

  const oauthUsers = await prisma.account.findMany({
    where: { type: "oauth" },
    select: { userId: true },
    distinct: ["userId"],
  })

  const oauthUserIds = oauthUsers.map((u) => u.userId)

  if (oauthUserIds.length > 0) {
    await prisma.user.updateMany({
      where: { id: { in: oauthUserIds } },
      data: { emailVerifiedForCredits: true },
    })
  }

  console.log(`Updated ${userIdsWithKeys.length} users with API keys to USER_OWN_KEY`)
  console.log(`Updated ${oauthUserIds.length} OAuth users with emailVerifiedForCredits`)
}

main().catch(console.error)
