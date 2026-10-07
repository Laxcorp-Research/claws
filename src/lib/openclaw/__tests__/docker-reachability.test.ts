import { afterEach, describe, expect, it } from "vitest"
import { gatewayWebSocketUrl } from "@/lib/openclaw/docker-engine"
import { syncNowRequestUrl } from "@/lib/openclaw/sync-now"

afterEach(() => {
  delete process.env.CLAWS_PROFILE
})

describe("docker reachability", () => {
  it("DOCKER gateway URL is ws; Railway stays wss", () => {
    expect(gatewayWebSocketUrl("claws-ws:18789", "DOCKER")).toBe("ws://claws-ws:18789")
    expect(gatewayWebSocketUrl("claw.up.railway.app", "RAILWAY")).toBe("wss://claw.up.railway.app")
  })

  it("self-host sync-now uses http; hosted stays https", () => {
    expect(syncNowRequestUrl("claws-ws:18789")).toBe("https://claws-ws:18789/internal/sync-now")
    process.env.CLAWS_PROFILE = "self-host"
    expect(syncNowRequestUrl("claws-ws:18789")).toBe("http://claws-ws:18789/internal/sync-now")
  })
})
