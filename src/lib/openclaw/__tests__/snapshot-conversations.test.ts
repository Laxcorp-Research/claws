import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import {
  __clearSnapshotConversationsCacheForTests,
  buildRuntimeStateGzipFixture,
  isAllowedSessionPath,
  loadSnapshotConversationsFromGzip,
  readAllowedSessionFile,
  readSnapshotSessionMessages,
  snapshotConversationsCacheKey,
  SNAPSHOT_UNCOMPRESSED_CEILING_BYTES,
} from "@/lib/openclaw/snapshot-conversations"

const OLD_MAIN = "6f484ca3-1111-2222-3333-444444444444"
const NEW_MAIN = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
const AS_OF = new Date("2026-07-11T12:41:00.000Z")

function orphanedMainFixtureFiles(): Record<string, string> {
  const index = {
    "agent:dev-commander:main": NEW_MAIN,
  }
  const oldJsonl = [
    JSON.stringify({
      role: "user",
      content: "Jul 8 pre-rotation message",
      timestamp: "2026-07-08T06:30:00.000Z",
    }),
    JSON.stringify({
      role: "assistant",
      content: "Acknowledged before rotation",
      timestamp: "2026-07-08T06:31:00.000Z",
    }),
  ].join("\n")
  const newJsonl = [
    JSON.stringify({
      role: "user",
      content: "Post-redeploy main",
      timestamp: "2026-07-11T12:42:00.000Z",
    }),
  ].join("\n")
  return {
    "agents/dev-commander/sessions/sessions.json": JSON.stringify(index),
    [`agents/dev-commander/sessions/${NEW_MAIN}.jsonl`]: newJsonl,
    [`agents/dev-commander/sessions/${OLD_MAIN}.jsonl`]: oldJsonl,
    // secret material must never be readable via session path API
    ".env": "ANTHROPIC_API_KEY=sk-secret\n",
    "openclaw.json": '{"gateway":{}}',
  }
}

afterEach(() => {
  __clearSnapshotConversationsCacheForTests()
})

describe("isAllowedSessionPath — path allowlist", () => {
  it("allows agents/<id>/sessions/<file> only", () => {
    expect(isAllowedSessionPath("agents/dev-commander/sessions/sessions.json")).toBe(true)
    expect(isAllowedSessionPath(`agents/dev-commander/sessions/${OLD_MAIN}.jsonl`)).toBe(true)
  })

  it("denies ../.env and other traversal / non-session paths", () => {
    expect(isAllowedSessionPath("../.env")).toBe(false)
    expect(isAllowedSessionPath("agents/dev-commander/sessions/../../../.env")).toBe(false)
    expect(isAllowedSessionPath(".env")).toBe(false)
    expect(isAllowedSessionPath("openclaw.json")).toBe(false)
    expect(isAllowedSessionPath("agents/dev-commander/MEMORY.md")).toBe(false)
    expect(isAllowedSessionPath("agents//sessions/x.jsonl")).toBe(false)
  })

  it("readAllowedSessionFile never returns .env even when present in the bundle", () => {
    const files = {
      ".env": Buffer.from("SECRET=1").toString("base64"),
      "agents/a/sessions/../../../.env": Buffer.from("SECRET=2").toString("base64"),
      "agents/a/sessions/ok.jsonl": Buffer.from("{}\n").toString("base64"),
    }
    expect(readAllowedSessionFile(files, "../.env")).toBeNull()
    expect(readAllowedSessionFile(files, ".env")).toBeNull()
    expect(readAllowedSessionFile(files, "agents/a/sessions/../../../.env")).toBeNull()
    expect(readAllowedSessionFile(files, "agents/a/sessions/ok.jsonl")).toBe("{}\n")
  })

  it("MUTATION: dropping allowlist would expose .env via readAllowedSessionFile", () => {
    const src = readFileSync(join(__dirname, "../snapshot-conversations.ts"), "utf8")
    // Guard presence: allowlist must reject ".." segments.
    expect(src).toMatch(/p === "\.\."/)
    expect(src).toContain("agents")
    expect(src).toContain("sessions")

    // Simulate mutation: always-allow reader (what dropping the guard would do).
    const files = { ".env": Buffer.from("ANTHROPIC_API_KEY=sk-leak").toString("base64") }
    const mutatedRead = (path: string) => {
      const b64 = files[path as keyof typeof files]
      return typeof b64 === "string" ? Buffer.from(b64, "base64").toString("utf8") : null
    }
    expect(mutatedRead(".env")).toContain("sk-leak")
    // Real path still denies.
    expect(readAllowedSessionFile(files, ".env")).toBeNull()
  })
})

describe("orphaned / rotated mains (E evidence class)", () => {
  it("surfaces orphaned prior main in archived with reason rotated-main", () => {
    const gzip = buildRuntimeStateGzipFixture(orphanedMainFixtureFiles())
    const result = loadSnapshotConversationsFromGzip({
      workspaceId: "ws-founder",
      gzipBytes: gzip,
      runtimeStateUpdatedAt: AS_OF,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.view.asOf).toBe(AS_OF.toISOString())
    expect(result.view.conversations.map((c) => c.sessionKey)).toEqual([
      "agent:dev-commander:main",
    ])
    expect(result.view.conversations[0]?.messageCount).toBe(1)

    const archived = result.view.archived.find((a) => a.sessionKey === `orphaned:${OLD_MAIN}`)
    expect(archived).toMatchObject({
      sessionKey: `orphaned:${OLD_MAIN}`,
      reason: "rotated-main",
      messageCount: 2,
      lastActivityAt: "2026-07-08T06:31:00.000Z",
    })

    const messages = readSnapshotSessionMessages(result.files, `orphaned:${OLD_MAIN}`)
    expect(messages?.some((m) => m.type === "message" && m.content.includes("Jul 8"))).toBe(true)
  })

  it("classifies deleted and reset artifacts", () => {
    const deletedUuid = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
    const resetUuid = "cccccccc-cccc-cccc-cccc-cccccccccccc"
    const gzip = buildRuntimeStateGzipFixture({
      "agents/main/sessions/sessions.json": JSON.stringify({
        "agent:main:main": NEW_MAIN,
      }),
      [`agents/main/sessions/${NEW_MAIN}.jsonl`]: JSON.stringify({
        role: "user",
        content: "live",
        timestamp: "2026-07-11T00:00:00.000Z",
      }),
      [`agents/main/sessions/${deletedUuid}.jsonl.deleted.2026-07-08T06-36-00`]: JSON.stringify({
        role: "user",
        content: "gone",
        timestamp: "2026-07-08T06:00:00.000Z",
      }),
      [`agents/main/sessions/${resetUuid}.jsonl.reset.2026-07-11`]: JSON.stringify({
        role: "user",
        content: "reset",
        timestamp: "2026-07-10T00:00:00.000Z",
      }),
    })
    const result = loadSnapshotConversationsFromGzip({
      workspaceId: "ws-2",
      gzipBytes: gzip,
      runtimeStateUpdatedAt: AS_OF,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const byKey = Object.fromEntries(result.view.archived.map((a) => [a.sessionKey, a.reason]))
    expect(byKey[`orphaned:${deletedUuid}`]).toBe("deleted")
    expect(byKey[`orphaned:${resetUuid}`]).toBe("reset")
  })
})

describe("response cache keyed (workspaceId, runtimeStateUpdatedAt)", () => {
  it("cache hit on same runtimeStateUpdatedAt; new asOf loads new content", () => {
    const gzipA = buildRuntimeStateGzipFixture({
      "agents/a/sessions/sessions.json": JSON.stringify({ "agent:a:main": NEW_MAIN }),
      [`agents/a/sessions/${NEW_MAIN}.jsonl`]: JSON.stringify({
        role: "user",
        content: "version-A",
        timestamp: "2026-07-01T00:00:00.000Z",
      }),
    })
    const gzipB = buildRuntimeStateGzipFixture({
      "agents/a/sessions/sessions.json": JSON.stringify({ "agent:a:main": NEW_MAIN }),
      [`agents/a/sessions/${NEW_MAIN}.jsonl`]: JSON.stringify({
        role: "user",
        content: "version-B",
        timestamp: "2026-07-02T00:00:00.000Z",
      }),
    })

    const t1 = new Date("2026-07-11T12:00:00.000Z")
    const t2 = new Date("2026-07-11T13:00:00.000Z")

    const first = loadSnapshotConversationsFromGzip({
      workspaceId: "ws-cache",
      gzipBytes: gzipA,
      runtimeStateUpdatedAt: t1,
    })
    const second = loadSnapshotConversationsFromGzip({
      workspaceId: "ws-cache",
      gzipBytes: gzipB, // different bytes — must be ignored on cache hit
      runtimeStateUpdatedAt: t1,
    })
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(second.view.conversations[0]?.lastActivityAt).toBe(first.view.conversations[0]?.lastActivityAt)

    const third = loadSnapshotConversationsFromGzip({
      workspaceId: "ws-cache",
      gzipBytes: gzipB,
      runtimeStateUpdatedAt: t2,
    })
    expect(third.ok).toBe(true)
    if (!third.ok) return
    expect(third.view.conversations[0]?.lastActivityAt).toBe("2026-07-02T00:00:00.000Z")
  })

  it("MUTATION: cache keyed on workspaceId only would stale-serve across asOf", () => {
    const src = readFileSync(join(__dirname, "../snapshot-conversations.ts"), "utf8")
    expect(src).toContain("workspaceId}::${runtimeStateUpdatedAt.toISOString()")

    // Prove the stale-serve failure mode if key were wsId-only.
    const staleCache = new Map<string, string>()
    const badKey = (workspaceId: string, _updatedAt: Date) => workspaceId
    const goodKey = snapshotConversationsCacheKey

    const t1 = new Date("2026-07-11T12:00:00.000Z")
    const t2 = new Date("2026-07-11T13:00:00.000Z")
    staleCache.set(badKey("ws", t1), "A")
    // Under mutated keying, t2 overwrites nothing new — still serves A
    expect(staleCache.get(badKey("ws", t2))).toBe("A")

    const good = new Map<string, string>()
    good.set(goodKey("ws", t1), "A")
    expect(good.get(goodKey("ws", t2))).toBeUndefined()
  })
})

describe("OpenClaw session JSONL shape", () => {
  it("reads wrapped message.content text and ignores trajectory overwrite", () => {
    const uuid = "88edda74-0689-403b-a7b6-0107cf3a6877"
    const jsonl = [
      JSON.stringify({
        type: "message",
        timestamp: "2026-07-13T16:08:01.398Z",
        message: {
          role: "user",
          content: [{ type: "text", text: "Please run another trend scan now." }],
        },
      }),
      JSON.stringify({
        type: "message",
        timestamp: "2026-07-13T16:08:12.243Z",
        message: {
          role: "assistant",
          content: [
            { type: "toolCall", id: "t1", name: "sessions_spawn", arguments: {} },
            { type: "text", text: "Spawned the Trend & Topic Scout at 16:07 UTC!" },
          ],
        },
      }),
    ].join("\n")
    const trajectory = JSON.stringify({
      type: "trace.metadata",
      ts: "2026-07-13T16:08:01.000Z",
      sessionId: uuid,
    })
    const gzip = buildRuntimeStateGzipFixture({
      "agents/twitter-commander/sessions/sessions.json": JSON.stringify({
        "agent:twitter-commander:main": uuid,
      }),
      [`agents/twitter-commander/sessions/${uuid}.jsonl`]: jsonl,
      [`agents/twitter-commander/sessions/${uuid}.trajectory.jsonl`]: trajectory,
    })
    const result = loadSnapshotConversationsFromGzip({
      workspaceId: "ws-openclaw-shape",
      gzipBytes: gzip,
      runtimeStateUpdatedAt: AS_OF,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.view.conversations[0]?.lastActivityAt).toBe("2026-07-13T16:08:12.243Z")
    const messages = readSnapshotSessionMessages(result.files, "agent:twitter-commander:main")
    expect(messages?.some((m) => m.type === "message" && m.content.includes("trend scan"))).toBe(true)
    expect(messages?.some((m) => m.type === "message" && m.content.includes("16:07 UTC"))).toBe(true)
    expect(messages?.some((m) => m.type === "tool" && m.name === "sessions_spawn")).toBe(true)
  })
})

describe("size ceiling", () => {
  it("returns honest too_large when uncompressed totalSize exceeds 100MB", () => {
    const gzip = buildRuntimeStateGzipFixture(
      {
        "agents/a/sessions/sessions.json": "{}",
      },
      SNAPSHOT_UNCOMPRESSED_CEILING_BYTES + 1,
    )
    // Bypass DB size short-circuit by omitting runtimeStateSizeBytes; ceiling hits on bundle.totalSize
    const result = loadSnapshotConversationsFromGzip({
      workspaceId: "ws-huge",
      gzipBytes: gzip,
      runtimeStateUpdatedAt: AS_OF,
    })
    expect(result).toMatchObject({
      ok: false,
      reason: "too_large",
      asOf: AS_OF.toISOString(),
    })
  })

  it("returns too_large from DB size before inflate when runtimeStateSizeBytes is over ceiling", () => {
    const gzip = buildRuntimeStateGzipFixture(orphanedMainFixtureFiles())
    const result = loadSnapshotConversationsFromGzip({
      workspaceId: "ws-huge-db",
      gzipBytes: gzip,
      runtimeStateUpdatedAt: AS_OF,
      runtimeStateSizeBytes: SNAPSHOT_UNCOMPRESSED_CEILING_BYTES + 50,
    })
    expect(result).toMatchObject({ ok: false, reason: "too_large" })
  })
})
