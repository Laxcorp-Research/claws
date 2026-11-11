import { afterEach, describe, expect, it } from "vitest"
import { FIXTURE_MODEL_REPLY, FIXTURE_MODEL_USAGE } from "@/lib/openclaw/gateway-origin"
import { POST } from "../route"

describe("fixture model messages", () => {
  afterEach(() => {
    delete process.env.CLAWS_PROFILE
  })

  it("returns 404 when the profile is hosted", async () => {
    delete process.env.CLAWS_PROFILE
    const res = await POST(new Request("http://app:3000/api/internal/fixture-model/v1/messages", {
      method: "POST",
      body: JSON.stringify({ model: "claude-haiku-4-5", stream: false }),
    }))
    expect(res.status).toBe(404)
  })

  it("returns fixture-reply and token usage for a self-host messages call", async () => {
    process.env.CLAWS_PROFILE = "self-host"
    const res = await POST(new Request("http://app:3000/api/internal/fixture-model/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", stream: false }),
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.content[0].text).toBe(FIXTURE_MODEL_REPLY)
    expect(body.usage.input_tokens).toBe(FIXTURE_MODEL_USAGE.input)
    expect(body.usage.output_tokens).toBe(FIXTURE_MODEL_USAGE.output)
  })

  it("streams the same reply when the runtime asks for SSE", async () => {
    process.env.CLAWS_PROFILE = "self-host"
    const res = await POST(new Request("http://app:3000/api/internal/fixture-model/v1/messages", {
      method: "POST",
      body: JSON.stringify({ model: "claude-haiku-4-5-20251001", stream: true }),
    }))
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/event-stream")
    const text = await res.text()
    expect(text).toContain(FIXTURE_MODEL_REPLY)
    expect(text).toContain(`"output_tokens":${FIXTURE_MODEL_USAGE.output}`)
  })
})
