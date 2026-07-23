// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import PricingPage from "@/app/pricing/page"

vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: null, status: "unauthenticated" }),
}))
vi.mock("next/navigation", () => ({
  usePathname: () => "/pricing",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("PricingPage Batch A / A4 — marketplace sole source", () => {
  it("renders free/paid names from marketplace API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const href = String(input)
        if (href.includes("/api/tools/catalog-count")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                success: true,
                data: { count: 1234, label: "1200+" },
              }),
          })
        }
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              data: {
                items: [
                  { name: "Free Alpha", price: 0, isFree: true },
                  { name: "Biz Beta", price: 49, isFree: false },
                  { name: "Vert Gamma", price: 99, isFree: false },
                ],
                nextCursor: null,
              },
            }),
        })
      }) as unknown as typeof fetch,
    )

    render(<PricingPage />)
    await waitFor(() => {
      expect(screen.getByText(/Free Alpha/)).toBeTruthy()
    })
    expect(screen.getByText(/Biz Beta/)).toBeTruthy()
    expect(screen.getByText(/Vert Gamma/)).toBeTruthy()
    expect(screen.getByText("1 templates, free forever")).toBeTruthy()
    expect(screen.getByText("1200+ tool integrations")).toBeTruthy()
  })

  it("shows honest error when marketplace fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          json: () =>
            Promise.resolve({
              success: false,
              error: { message: "catalog down" },
            }),
        }),
      ) as unknown as typeof fetch,
    )

    render(<PricingPage />)
    expect(await screen.findByText("Couldn't load the template catalog")).toBeTruthy()
    expect(screen.getByText("catalog down")).toBeTruthy()
  })
})
