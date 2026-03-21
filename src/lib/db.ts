import { PrismaClient } from "@/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString || connectionString.includes("placeholder")) {
    // Return a client that will fail gracefully when no real DB is configured
    const adapter = new PrismaPg({ connectionString: "postgresql://localhost:5432/claws" })
    return new PrismaClient({ adapter })
  }
  const adapter = new PrismaPg({ connectionString })
  return new PrismaClient({ adapter })
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma
