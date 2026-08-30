import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { USER_MD_INTERVIEW_COMPLETE_TOKEN } from "@/lib/user-md-interview"
import {
  PLATFORM_INTERVIEW_COMPLETE_TOKEN,
  PLATFORM_RENDER_STRIP_TOKENS,
  isProtocolOnlyChatBody,
  stripPlatformSentinels,
} from "@/lib/chat/platform-sentinels"

describe("platform chat sentinels", () => {
  it("strip list is the interview token the activity scan uses", () => {
    expect(PLATFORM_INTERVIEW_COMPLETE_TOKEN).toBe(USER_MD_INTERVIEW_COMPLETE_TOKEN)
    expect(PLATFORM_RENDER_STRIP_TOKENS).toContain(USER_MD_INTERVIEW_COMPLETE_TOKEN)
  })

  it("strips the interview token and keeps the human sentence", () => {
    const raw = "Profile saved. CLAWS_USER_MD_INTERVIEW_COMPLETE"
    expect(stripPlatformSentinels(raw)).toBe("Profile saved.")
    expect(stripPlatformSentinels(raw)).not.toContain(USER_MD_INTERVIEW_COMPLETE_TOKEN)
  })

  it("NO_REPLY-only and token-only bodies are protocol-only", () => {
    expect(isProtocolOnlyChatBody("NO_REPLY")).toBe(true)
    expect(isProtocolOnlyChatBody("  CLAWS_USER_MD_INTERVIEW_COMPLETE  ")).toBe(true)
    expect(isProtocolOnlyChatBody("Profile saved. CLAWS_USER_MD_INTERVIEW_COMPLETE")).toBe(false)
    expect(isProtocolOnlyChatBody("hello")).toBe(false)
  })

  it("generated prose only tells the agent to emit interview-complete and NO_REPLY", () => {
    const files = [
      "src/lib/openclaw/generator.ts",
      "src/lib/user-md-interview.ts",
      "prisma/seed-data/wave-0-twitter.ts",
    ]
    const emitHits = new Set<string>()
    const emitRe = /(?:emit|include|reply with)\s+([A-Z][A-Z0-9_]{5,})/g
    for (const rel of files) {
      const src = readFileSync(join(process.cwd(), rel), "utf8")
      for (const match of src.matchAll(emitRe)) {
        emitHits.add(match[1])
      }
    }
    expect([...emitHits].sort()).toEqual(["CLAWS_USER_MD_INTERVIEW_COMPLETE", "NO_REPLY"])
  })
})
