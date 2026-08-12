import dotenv from "dotenv"
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: ".env.staging" })
}

import { PrismaClient } from "../src/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" })
const prisma = new PrismaClient({ adapter })

const PINNED = [
  { modelId: "anthropic/claude-haiku-4-5-20251001", provider: "ANTHROPIC", displayName: "Claude Haiku 4.5", costPer1kEst: 0.001, isPinned: true },
  { modelId: "anthropic/claude-sonnet-4-6", provider: "ANTHROPIC", displayName: "Claude Sonnet 4.6", costPer1kEst: 0.015, isPinned: true },
  { modelId: "anthropic/claude-opus-4-6", provider: "ANTHROPIC", displayName: "Claude Opus 4.6", costPer1kEst: 0.075, isPinned: true },
  { modelId: "openai/gpt-4o", provider: "OPENAI", displayName: "GPT-4o", costPer1kEst: 0.025, isPinned: true },
  { modelId: "openai/gpt-4o-mini", provider: "OPENAI", displayName: "GPT-4o Mini", costPer1kEst: 0.003, isPinned: true },
  { modelId: "google/gemini-2.5-pro", provider: "GOOGLE", displayName: "Gemini 2.5 Pro", costPer1kEst: 0.02, isPinned: true },
  { modelId: "openrouter/openai/gpt-4o-mini", provider: "OPENROUTER", displayName: "GPT-4o Mini (via OpenRouter)", costPer1kEst: 0.003, isPinned: true },
  { modelId: "openrouter/google/gemini-2.0-flash-001", provider: "OPENROUTER", displayName: "Gemini 2.0 Flash (via OpenRouter)", costPer1kEst: 0.002, isPinned: true },
  { modelId: "openrouter/meta-llama/llama-3.3-70b-instruct", provider: "OPENROUTER", displayName: "Llama 3.3 70B (via OpenRouter)", costPer1kEst: 0.004, isPinned: true },
]

async function main() {
  const now = new Date()
  for (const s of PINNED) {
    await prisma.modelCatalogEntry.upsert({
      where: { modelId: s.modelId },
      create: { ...s, source: "seed", isActive: true, refreshedAt: now },
      update: {
        displayName: s.displayName,
        costPer1kEst: s.costPer1kEst,
        isPinned: true,
        isActive: true,
        refreshedAt: now,
      },
    })
  }
  console.log("seeded", PINNED.length)

  const res = await fetch("https://openrouter.ai/api/v1/models")
  if (!res.ok) throw new Error(`OpenRouter /models ${res.status}`)
  const body = (await res.json()) as {
    data?: Array<{ id: string; name?: string; context_length?: number }>
  }
  const data = body.data ?? []
  let n = 0
  for (const m of data) {
    const modelId = `openrouter/${m.id}`
    const pinned = PINNED.some((p) => p.modelId === modelId)
    await prisma.modelCatalogEntry.upsert({
      where: { modelId },
      create: {
        modelId,
        provider: "OPENROUTER",
        displayName: m.name || m.id,
        contextLength: m.context_length ?? null,
        isPinned: pinned,
        isActive: true,
        source: "openrouter",
        refreshedAt: now,
      },
      update: {
        displayName: m.name || m.id,
        contextLength: m.context_length ?? null,
        isActive: true,
        source: "openrouter",
        refreshedAt: now,
        ...(pinned ? { isPinned: true } : {}),
      },
    })
    n++
    if (n % 100 === 0) console.log("upserted", n)
  }
  console.log("openrouter upserted", n)
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect().catch(() => {})
  process.exit(1)
})
