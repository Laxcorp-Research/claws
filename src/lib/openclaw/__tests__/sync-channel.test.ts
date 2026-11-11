import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { syncAppOrigin, syncMeteringEndpoint } from "@/lib/openclaw/sync-channel"

describe("sync channel", () => {
  afterEach(() => {
    delete process.env.CONTROL_PLANE_INTERNAL_URL
    delete process.env.CLAWS_PROFILE
    delete process.env.NEXT_PUBLIC_APP_URL
  })

  it("self-host dials the compose app, not the public localhost URL", () => {
    process.env.CLAWS_PROFILE = "self-host"
    process.env.NEXT_PUBLIC_APP_URL = "http://localhost:3000"
    process.env.CONTROL_PLANE_INTERNAL_URL = "http://app:3000"
    expect(syncAppOrigin()).toBe("http://app:3000")
    expect(syncMeteringEndpoint()).toBe("http://app:3000/api/internal/metering")
  })

  it("CI uses the port Next actually listens on", () => {
    process.env.CLAWS_PROFILE = "self-host"
    process.env.CONTROL_PLANE_INTERNAL_URL = "http://app:3001"
    expect(syncMeteringEndpoint()).toBe("http://app:3001/api/internal/metering")
  })

  it("restore log line is the wake receipt", () => {
    const src = readFileSync(join(process.cwd(), "container/process-manager.mjs"), "utf8")
    expect(src).toContain("Runtime state restored from")
  })
})
