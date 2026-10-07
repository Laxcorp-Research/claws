import { afterEach, describe, expect, it, vi } from "vitest"
import { telegramDeliveryMode, telegramSetWakeWebhook } from "@/lib/channels/telegram-bot-api"
import { pollTelegramOnce, runTelegramLongPoll } from "@/lib/channels/telegram-poll"

afterEach(() => {
  delete process.env.CLAWS_PROFILE
  delete process.env.NEXT_PUBLIC_APP_URL
  delete process.env.NEXTAUTH_URL
  delete process.env.VERCEL_URL
  vi.unstubAllGlobals()
})

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })
}

describe("telegram getUpdates polling", () => {
  it("self-host polls even when a public URL is set; hosted with a URL uses the webhook", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.buildclaws.ai"
    expect(telegramDeliveryMode()).toBe("webhook")
    process.env.CLAWS_PROFILE = "self-host"
    expect(telegramDeliveryMode()).toBe("poll")
  })

  it("hosted with no public URL polls", () => {
    expect(telegramDeliveryMode()).toBe("poll")
  })

  it("deletes the webhook, then returns text messages and the next offset", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      const href = String(url)
      if (href.endsWith("/deleteWebhook")) return jsonResponse({ ok: true, result: true })
      if (href.endsWith("/getUpdates")) {
        return jsonResponse({
          ok: true,
          result: [
            { update_id: 10, message: { message_id: 1, text: "hello", chat: { id: 42 } } },
            { update_id: 11, message: { message_id: 2, chat: { id: 42 } } },
          ],
        })
      }
      throw new Error(`unexpected ${href}`)
    })

    const batch = await pollTelegramOnce({
      botToken: "123:abc",
      offset: 0,
      dropWebhook: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain("/deleteWebhook")
    const getUpdates = fetchImpl.mock.calls[1]
    expect(String(getUpdates?.[0])).toContain("/getUpdates")
    const body = JSON.parse(String(getUpdates?.[1]?.body))
    expect(body.offset).toBe(0)
    expect(body.allowed_updates).toEqual(["message"])
    expect(batch.messages).toEqual([
      { updateId: 10, chatId: 42, text: "hello", messageId: 1 },
    ])
    expect(batch.nextOffset).toBe(12)
  })

  it("long-poll advances the offset only after the handler resolves", async () => {
    const seenOffsets: number[] = []
    let calls = 0
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url)
      if (href.endsWith("/deleteWebhook")) return jsonResponse({ ok: true, result: true })
      calls += 1
      const body = JSON.parse(String(init?.body ?? "{}")) as { offset?: number }
      if (typeof body.offset === "number") seenOffsets.push(body.offset)
      if (calls === 1) {
        return jsonResponse({
          ok: true,
          result: [{ update_id: 4, message: { message_id: 9, text: "ping", chat: { id: 7 } } }],
        })
      }
      return jsonResponse({ ok: true, result: [] })
    })

    const controller = new AbortController()
    const seen: string[] = []
    const done = runTelegramLongPoll({
      botToken: "123:abc",
      signal: controller.signal,
      timeoutSec: 0,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onMessage: async (message) => {
        seen.push(message.text)
        controller.abort()
      },
    })
    await done
    expect(seen).toEqual(["ping"])
    expect(seenOffsets[0]).toBe(0)
  })

  it("self-host setWakeWebhook does not call Telegram setWebhook", async () => {
    process.env.CLAWS_PROFILE = "self-host"
    process.env.NEXT_PUBLIC_APP_URL = "https://app.buildclaws.ai"
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }))
    vi.stubGlobal("fetch", fetchImpl)
    const ok = await telegramSetWakeWebhook({ botToken: "123:abc", workspaceId: "ws-1" })
    expect(ok).toBe(false)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
