import { gzipSync } from "node:zlib"
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../../src/generated/prisma/client"

export const E2E_SNAPSHOT_AS_OF = "2026-07-11T12:41:00.000Z"
export const E2E_OLD_MAIN = "6f484ca3-1111-2222-3333-444444444444"
export const E2E_NEW_MAIN = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
export const E2E_TRANSCRIPT_EXCERPT = "E2E hibernated trend-scan hello"

function buildGzipFixture(fileContents: Record<string, string>): Buffer {
  const files: Record<string, string> = {}
  let totalSize = 0
  for (const [path, content] of Object.entries(fileContents)) {
    const buf = Buffer.from(content, "utf8")
    totalSize += buf.length
    files[path] = buf.toString("base64")
  }
  return gzipSync(JSON.stringify({ files, totalSize }))
}

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error("DATABASE_URL required to seed hibernated conversations fixture")
  }
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
}

/**
 * Seeds a HIBERNATED workspace owned by the E2E test user with a real
 * runtimeStateSnapshot (gzip bundle). Conversations API + UI hit this row —
 * no route mocking (real-surface).
 */
export async function seedHibernatedConversationsFixture(): Promise<{
  workspaceId: string
  asOf: string
}> {
  const prisma = createClient()
  try {
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: "e2e-test@buildclaws.ai" },
    })

    const gzip = buildGzipFixture({
      "agents/dev-commander/sessions/sessions.json": JSON.stringify({
        "agent:dev-commander:main": E2E_NEW_MAIN,
      }),
      [`agents/dev-commander/sessions/${E2E_NEW_MAIN}.jsonl`]: [
        JSON.stringify({
          role: "user",
          content: E2E_TRANSCRIPT_EXCERPT,
          timestamp: "2026-07-13T16:07:12.000Z",
        }),
        JSON.stringify({
          role: "assistant",
          content: "E2E assistant ack",
          timestamp: "2026-07-13T16:08:44.000Z",
        }),
      ].join("\n"),
      [`agents/dev-commander/sessions/${E2E_OLD_MAIN}.jsonl`]: JSON.stringify({
        role: "user",
        content: "pre-rotation orphan",
        timestamp: "2026-07-08T06:30:00.000Z",
      }),
    })

    const asOf = new Date(E2E_SNAPSHOT_AS_OF)
    const slug = `e2e-hibernated-conversations-${Date.now()}`

    const workspace = await prisma.workspace.create({
      data: {
        userId: user.id,
        name: "E2E Hibernated Conversations",
        slug,
        status: "HIBERNATED",
        containerState: {
          create: {
            containerPhase: "HIBERNATED",
            runtimeStateSnapshot: new Uint8Array(gzip),
            runtimeStateUpdatedAt: asOf,
            runtimeStateSizeBytes: gzip.length,
          },
        },
      },
      select: { id: true },
    })

    return { workspaceId: workspace.id, asOf: asOf.toISOString() }
  } finally {
    await prisma.$disconnect()
  }
}
