import { describe, expect, it } from "vitest"
import { gatewayFailureHeadline } from "@/lib/openclaw/gateway-failure"
import { gatewayUpgradeHeaders, trustedProxiesForGateway } from "@/lib/openclaw/gateway-ingress"
import { showClawHealthHistory } from "@/components/dashboard/claw-health-line"

describe("self-host gateway ingress", () => {
  it("drops forwarded hop headers and keeps Origin", () => {
    const headers = gatewayUpgradeHeaders("ws://claws-ws:18789/", {
      "X-Forwarded-For": "203.0.113.5",
      "X-Forwarded-Host": "evil.example",
      Forwarded: "for=203.0.113.5",
      "X-Real-Ip": "203.0.113.5",
    })
    expect(headers.Origin).toBe("https://claws-ws:18789")
    expect(headers.Upgrade).toBe("websocket")
    expect(headers["Sec-WebSocket-Version"]).toBe("13")
    expect(Object.keys(headers).some((key) => key.toLowerCase().includes("forward"))).toBe(false)
    expect(Object.keys(headers).some((key) => key.toLowerCase() === "x-real-ip")).toBe(false)
  })

  it("omits trusted proxies for a direct client and keeps the hosted list otherwise", () => {
    expect(trustedProxiesForGateway(true)).toBeNull()
    expect(trustedProxiesForGateway(false)).toEqual([
      "100.64.0.0/10",
      "10.0.0.0/8",
      "172.16.0.0/12",
    ])
  })

  it("pulls the gateway rejection sentence out of a 403 body or a log line", () => {
    const body =
      '{"error":{"message":"Proxy client attribution is required. Configure gateway.trustedProxies narrowly.","type":"proxy_attribution_required"}}'
    expect(gatewayFailureHeadline(body)).toBe(
      "Proxy client attribution is required. Configure gateway.trustedProxies narrowly.",
    )
    const log =
      'gateway: observed unattributable proxy-shaped traffic from 172.20.0.2; Gateway-authenticated routes reject it.'
    expect(gatewayFailureHeadline(log)).toContain("proxy-shaped traffic")
    expect(gatewayFailureHeadline("all good")).toBeNull()
  })
})

describe("claw health line", () => {
  it("hides all clear when an error nudge is showing", () => {
    expect(showClawHealthHistory(0, true)).toBe(false)
    expect(showClawHealthHistory(0, false)).toBe(true)
    expect(showClawHealthHistory(2, true)).toBe(true)
  })
})
