// @vitest-environment jsdom
//
// PR-7 (Bug A root cause): the balance API's no-account branch returns only
// {hasCredits, balanceCents, status}. Without the EMPTY spread, the hook left
// totalConsumedCents/initialGrantCents undefined, which rendered "$NaN" on the
// Usage page. This locks the fully-shaped contract.

import { describe, it, expect, afterEach, vi } from "vitest"
import { renderHook, waitFor, cleanup } from "@testing-library/react"
import { useCreditBalance } from "@/hooks/use-credit-balance"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("useCreditBalance", () => {
  it("fills missing numeric fields for the no-account response (no undefined → no $NaN)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          json: () =>
            Promise.resolve({ success: true, data: { hasCredits: false, balanceCents: 0, status: null } }),
        }),
      ) as unknown as typeof fetch,
    )

    const { result } = renderHook(() => useCreditBalance())
    await waitFor(() => expect(result.current.loading).toBe(false))

    // These would be `undefined` without the EMPTY spread.
    expect(result.current.totalConsumedCents).toBe(0)
    expect(result.current.initialGrantCents).toBe(0)
    expect(result.current.balanceCents).toBe(0)
    expect(result.current.hasCredits).toBe(false)
    expect(result.current.status).toBeNull()
  })
})
