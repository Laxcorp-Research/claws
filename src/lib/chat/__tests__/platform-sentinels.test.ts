import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { USER_MD_INTERVIEW_COMPLETE_TOKEN } from "@/lib/user-md-interview"
import {
  PLATFORM_HEARTBEAT_OK_TOKEN,
  PLATFORM_INTERVIEW_COMPLETE_TOKEN,
  PLATFORM_RENDER_STRIP_TOKENS,
  isProtocolOnlyChatBody,
  stripPlatformSentinels,
} from "@/lib/chat/platform-sentinels"

describe("platform chat sentinels", () => {
  it("strip list is the interview token the activity scan uses plus HEARTBEAT_OK", () => {
    expect(PLATFORM_INTERVIEW_COMPLETE_TOKEN).toBe(USER_MD_INTERVIEW_COMPLETE_TOKEN)
    expect(PLATFORM_RENDER_STRIP_TOKENS).toContain(USER_MD_INTERVIEW_COMPLETE_TOKEN)
    expect(PLATFORM_RENDER_STRIP_TOKENS).toContain(PLATFORM_HEARTBEAT_OK_TOKEN)
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

  it("strips trailing HEARTBEAT_OK from a full reply; HEARTBEAT_OK-only is protocol-only", () => {
    expect(stripPlatformSentinels("Here's the recap.\nHEARTBEAT_OK")).toBe("Here's the recap.")
    expect(isProtocolOnlyChatBody("HEARTBEAT_OK")).toBe(true)
    expect(isProtocolOnlyChatBody("Here's the recap.\nHEARTBEAT_OK")).toBe(false)
  })

  it("generated prose only tells the agent to emit interview-complete, NO_REPLY, and HEARTBEAT_OK", () => {
    const files = [
      "src/lib/openclaw/generator.ts",
      "src/lib/user-md-interview.ts",
      "prisma/seed-data/wave-0-twitter.ts",
    ]
    const emitHits = new Set<string>()
    const emitRe = /(?:[Ee]mit|[Ii]nclude|[Rr]eply with)\s+([A-Z][A-Z0-9_]{5,})/g
    for (const rel of files) {
      const src = readFileSync(join(process.cwd(), rel), "utf8")
      for (const match of src.matchAll(emitRe)) {
        emitHits.add(match[1])
      }
    }
    expect([...emitHits].sort()).toEqual([
      "CLAWS_USER_MD_INTERVIEW_COMPLETE",
      "HEARTBEAT_OK",
      "NO_REPLY",
    ])
  })
})
