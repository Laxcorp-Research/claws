import { gzipSync } from "node:zlib"
import { Client } from "pg"

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

/**
 * Seeds a HIBERNATED workspace owned by the E2E test user with a real
 * runtimeStateSnapshot (gzip bundle). Uses `pg` (not Prisma client) so
 * Playwright's ESM loader does not choke on generated client.ts.
 */
export async function seedHibernatedConversationsFixture(): Promise<{
  workspaceId: string
  asOf: string
}> {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    throw new Error("DATABASE_URL required to seed hibernated conversations fixture")
  }

  const client = new Client({ connectionString })
  await client.connect()
  try {
    const userRes = await client.query<{ id: string }>(
      `SELECT id FROM "User" WHERE email = $1 LIMIT 1`,
      ["e2e-test@buildclaws.ai"],
    )
    const userId = userRes.rows[0]?.id
    if (!userId) {
      throw new Error("E2E test user e2e-test@buildclaws.ai not found — sign in first")
    }

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
    const workspaceId = `e2e_hib_conv_${Date.now().toString(36)}`

    await client.query(
      `INSERT INTO "Workspace" (id, "userId", name, slug, status, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 'HIBERNATED', NOW(), NOW())`,
      [workspaceId, userId, "E2E Hibernated Conversations", slug],
    )

    await client.query(
      `INSERT INTO "ContainerState" (
         id, "workspaceId", "containerPhase",
         "runtimeStateSnapshot", "runtimeStateUpdatedAt", "runtimeStateSizeBytes",
         "createdAt", "updatedAt"
       ) VALUES (
         $1, $2, 'HIBERNATED',
         $3, $4, $5,
         NOW(), NOW()
       )`,
      [
        `e2e_cs_${Date.now().toString(36)}`,
        workspaceId,
        gzip,
        asOf,
        gzip.length,
      ],
    )

    return { workspaceId, asOf: asOf.toISOString() }
  } finally {
    await client.end()
  }
}
