// -9: credit-proxy report-batch SUCCESS/FAILURE logs + SIGTERM flush count.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let cp: any
const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
const errSpy = vi.spyOn(console, "error").mockImplementation(() => {})

beforeEach(async () => {
  vi.resetModules()
  logSpy.mockClear()
  errSpy.mockClear()
  process.env.ANTHROPIC_API_KEY = "sk-test"
  process.env.CLAWS_METERING_ENDPOINT = "https://example.test/api/internal/metering"
  process.env.CLAWS_METERING_SECRET = "secret"
  process.env.CLAWS_WORKSPACE_ID = "ws-1"
  process.env.CLAWS_USER_ID = "user-1"
  cp = await import("../../container/credit-proxy.mjs")
})

afterEach(() => {
  // Clear UsageReporter intervals from constructed module reporter if any
})

describe("UsageReporter.flush observability (-9)", () => {
  it("logs report SUCCESS with batch size + status", async () => {
    const reporter = new cp.__test__.UsageReporter()
    clearInterval(reporter.flushInterval)
    reporter.pending.push({ a: 1 }, { a: 2 })

    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 }))
    const result = await reporter.flush({ fetchImpl, label: "test" })

    expect(result).toEqual({ flushed: 2, ok: true, status: 200 })
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("[credit-proxy] report-batch ok n=2 status=200"),
    )
  })

  it("logs report FAILURE with status + requeue depth", async () => {
    const reporter = new cp.__test__.UsageReporter()
    clearInterval(reporter.flushInterval)
    reporter.pending.push({ a: 1 })

    const fetchImpl = vi.fn(async () => ({ ok: false, status: 503 }))
    const result = await reporter.flush({ fetchImpl, label: "test" })

    expect(result.ok).toBe(false)
    expect(result.requeueDepth).toBe(1)
    expect(errSpy).toHaveBeenCalledWith(
      expect.stringContaining("[credit-proxy] report-batch failed status=503 requeueDepth=1"),
    )
  })

  it("SIGTERM shutdown logs flushed-count", async () => {
    const reporter = new cp.__test__.UsageReporter()
    clearInterval(reporter.flushInterval)
    reporter.pending.push({ a: 1 }, { a: 2 }, { a: 3 })
    const fetchImpl = vi.fn(async () => ({ ok: true, status: 200 }))
    // Patch instance flush to use stub fetch, then exercise shutdown log path
    const origFlush = reporter.flush.bind(reporter)
    reporter.flush = (opts = {}) => origFlush({ ...opts, fetchImpl })
    await reporter.shutdown()
    expect(
      logSpy.mock.calls.some((c) =>
        String(c[0]).includes("SIGTERM flush pendingBefore=3 flushed=3"),
      ),
    ).toBe(true)
  })

  it("MUTATION: flush must log report-batch ok/failed (drop logs → fail)", async () => {
    const src = await import("node:fs").then((fs) =>
      fs.readFileSync(
        new URL("../../container/credit-proxy.mjs", import.meta.url),
        "utf8",
      ),
    )
    expect(src).toContain("[credit-proxy] report-batch ok n=")
    expect(src).toContain("[credit-proxy] report-batch failed status=")
    expect(src).toContain("SIGTERM flush pendingBefore=")
  })
})
