// Fly machines-client pure helpers: image mirror mapping (GHCR gap), app
// naming, machine config shape (persist_rootfs nap/wake + the
// no-proxy-autostart entitlement rider).
import { describe, it, expect, beforeEach, afterEach } from "vitest"

import {
  buildFlyMachineConfig,
  flyAppDomain,
  flyAppNameForWorkspace,
  parseFlyMemoryMb,
  resolveFlyImage,
  FLY_INTERNAL_PORT,
} from "@/lib/fly/machines-client"

const ORIGINAL_PREFIX = process.env.FLY_IMAGE_MIRROR_PREFIX

beforeEach(() => {
  process.env.FLY_IMAGE_MIRROR_PREFIX = "registry.fly.io/claws-runtime"
})

afterEach(() => {
  if (ORIGINAL_PREFIX === undefined) delete process.env.FLY_IMAGE_MIRROR_PREFIX
  else process.env.FLY_IMAGE_MIRROR_PREFIX = ORIGINAL_PREFIX
  delete process.env.FLY_MACHINE_MEMORY_MB
})

describe("resolveFlyImage (GHCR private-pull gap)", () => {
  it("maps a ghcr.io ref onto the Fly mirror, preserving the version tag (version-aware images unchanged)", () => {
    expect(resolveFlyImage("ghcr.io/laxcorp-research/openclaw-runtime:2026.9.4-5")).toBe(
      "registry.fly.io/claws-runtime:2026.9.4-5",
    )
  })

  it("passes registry.fly.io refs through untouched", () => {
    expect(resolveFlyImage("registry.fly.io/other-app:v1")).toBe("registry.fly.io/other-app:v1")
  })

  it("untagged ref maps to :latest", () => {
    expect(resolveFlyImage("ghcr.io/laxcorp-research/openclaw-runtime")).toBe(
      "registry.fly.io/claws-runtime:latest",
    )
  })
})

describe("app naming / domain", () => {
  it("derives a DNS-safe per-claw app name and .fly.dev domain", () => {
    const name = flyAppNameForWorkspace("cmWs123ABC")
    expect(name).toBe("claw-cmws123abc")
    expect(flyAppDomain(name)).toBe("claw-cmws123abc.fly.dev")
  })
})

describe("parseFlyMemoryMb", () => {
  it("defaults to 1024 and rejects non-multiples of 256", () => {
    expect(parseFlyMemoryMb(undefined)).toBe(1024)
    expect(parseFlyMemoryMb("512")).toBe(512)
    expect(parseFlyMemoryMb("777")).toBe(1024)
    expect(parseFlyMemoryMb("128")).toBe(1024)
  })
})

describe("buildFlyMachineConfig", () => {
  const config = buildFlyMachineConfig({
    image: "registry.fly.io/claws-runtime:test",
    env: { CLAWS_WORKSPACE_ID: "ws-1" },
  }) as {
    guest: { persist_rootfs: string }
    services: Array<{ autostop: string; autostart: boolean; internal_port: number }>
    checks: { healthz: { path: string; port: number } }
  }

  it("HWD: rootfs persists across machine stop/start (persist_rootfs=restart)", () => {
    expect(config.guest.persist_rootfs).toBe("restart")
  })

  it("Rider-2 analog: the Fly proxy must NEVER auto-start a napping claw (entitlement gate)", () => {
    // Railway locks sleepApplication=false; the Fly equivalent is proxy
    // autostart/autostop off - wake must go through canWakeHibernatedWorkspace.
    expect(config.services[0].autostart).toBe(false)
    expect(config.services[0].autostop).toBe("off")
  })

  it("exposes the gateway port with a /healthz check (same health surface as Railway)", () => {
    expect(config.services[0].internal_port).toBe(FLY_INTERNAL_PORT)
    expect(config.checks.healthz.path).toBe("/healthz")
    expect(config.checks.healthz.port).toBe(FLY_INTERNAL_PORT)
  })
})
