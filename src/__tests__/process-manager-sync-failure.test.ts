// PR-2 -8: consecutive sync-failure → ERROR tracker (process-manager.mjs).
// Entrypoint is guarded so importing this module does not spawn the gateway.

import { describe, it, expect, beforeEach, vi } from "vitest"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pm: any

beforeEach(async () => {
  vi.resetModules()
  pm = await import("../../container/process-manager.mjs")
})

describe("createSyncFailureTracker — consecutive non-2xx token/finalize", () => {
  it("MUTATION-anchored: 3 consecutive rejects emit once; 2 do not; second emit suppressed until recovery", async () => {
    const emitError = vi.fn(
      async (_args: {
        httpStatus: number
        consecutive: number
        sizeKb: number
        path: string
      }) => {},
    )
    const tracker = pm.createSyncFailureTracker({ threshold: 3, emitError })

    const reject = (_n: number) => ({
      status: "rejected",
      httpStatus: 503,
      path: "finalize",
      sizeKb: 12,
      fileCount: 3,
    })

    // 2 fails — no emit. Dropping the threshold gate (emit on first) fails.
    expect((await tracker.noteResult(reject(1))).emitted).toBe(false)
    expect((await tracker.noteResult(reject(2))).emitted).toBe(false)
    expect(emitError).not.toHaveBeenCalled()

    // 3rd — emit once.
    expect((await tracker.noteResult(reject(3))).emitted).toBe(true)
    expect(emitError).toHaveBeenCalledTimes(1)
    expect(emitError).toHaveBeenCalledWith(
      expect.objectContaining({
        httpStatus: 503,
        consecutive: 3,
        sizeKb: 12,
        path: "finalize",
      }),
    )

    // Further fails in the same streak — suppressed.
    expect((await tracker.noteResult(reject(4))).emitted).toBe(false)
    expect((await tracker.noteResult(reject(5))).emitted).toBe(false)
    expect(emitError).toHaveBeenCalledTimes(1)

    // Recovery resets; a fresh streak can emit again.
    await tracker.noteResult({ status: "persisted", count: 1, fileCount: 1, sizeKb: 1 })
    expect(tracker.getState()).toEqual({ consecutive: 0, emittedForStreak: false })

    await tracker.noteResult(reject(1))
    await tracker.noteResult(reject(2))
    expect((await tracker.noteResult(reject(3))).emitted).toBe(true)
    expect(emitError).toHaveBeenCalledTimes(2)
  })

  it("does not count network errors or count===0 rejects without httpStatus", async () => {
    const emitError = vi.fn(async () => {})
    const tracker = pm.createSyncFailureTracker({ threshold: 3, emitError })

    await tracker.noteResult({ status: "error", path: "finalize", error: "timeout" })
    await tracker.noteResult({ status: "rejected", count: 0, path: "finalize", fileCount: 1, sizeKb: 1 })
    await tracker.noteResult({ status: "rejected", httpStatus: 502, path: "blob-put", sizeKb: 1 })
    expect(emitError).not.toHaveBeenCalled()
    expect(tracker.getState().consecutive).toBe(0)
  })

  it("counts blob-token non-2xx the same as finalize", async () => {
    const emitError = vi.fn(
      async (_args: {
        httpStatus: number
        consecutive: number
        sizeKb: number
        path: string
      }) => {},
    )
    const tracker = pm.createSyncFailureTracker({ threshold: 3, emitError })
    for (let i = 0; i < 3; i++) {
      await tracker.noteResult({
        status: "rejected",
        httpStatus: 401,
        path: "blob-token",
        sizeKb: 4,
      })
    }
    expect(emitError).toHaveBeenCalledTimes(1)
    expect(emitError).toHaveBeenCalledWith(expect.objectContaining({ path: "blob-token" }))
  })
})
