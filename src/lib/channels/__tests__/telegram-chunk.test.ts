import { describe, expect, it } from "vitest"
import {
  chunkTelegramText,
  TELEGRAM_MAX_MESSAGE_CHARS,
} from "@/lib/channels/telegram-bot-api"

describe("chunkTelegramText", () => {
  it("returns single chunk under the Bot API limit", () => {
    expect(chunkTelegramText("hi")).toEqual(["hi"])
  })

  it("splits at TELEGRAM_MAX_MESSAGE_CHARS", () => {
    const text = "a".repeat(TELEGRAM_MAX_MESSAGE_CHARS + 10)
    const chunks = chunkTelegramText(text)
    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toHaveLength(TELEGRAM_MAX_MESSAGE_CHARS)
    expect(chunks[1]).toHaveLength(10)
  })
})
