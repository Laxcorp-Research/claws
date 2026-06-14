// @vitest-environment jsdom
//
// GH #127 fix — admin/layout gate. The layout calls GET /api/admin/check once:
//   - check in flight        → LoadingSkeleton (never flash children OR access-denied)
//   - isAdmin: true          → renders children
//   - isAdmin: false         → renders <AdminAccessDenied />, NOT children
//   - check fails (network)  → fail-closed → <AdminAccessDenied />, NOT children
//
// Regression guards: removing the gate (rendering children unconditionally)
// breaks the non-admin test; making a failed check fall through to children
// breaks the fail-closed test.

import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import AdminLayout from "@/app/admin/layout"

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/reviews",
  useRouter: () => ({ push: vi.fn() }),
}))

// Isolate the gate: stub PageShell (it renders TopBar, which itself calls
// /api/admin/check and needs a session) down to a passthrough.
vi.mock("@/components/shared/page-shell", () => ({
  PageShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

const CHILD = "ADMIN_CHILDREN_CONTENT"
const DENIED = "You don't have admin access"

function renderLayout() {
  return render(
    <AdminLayout>
      <div>{CHILD}</div>
    </AdminLayout>,
  )
}

afterEach(() => cleanup())
beforeEach(() => {
  vi.restoreAllMocks()
})

describe("AdminLayout gate (GH #127)", () => {
  it("shows a loading skeleton while the check is in flight — no children, no access-denied", () => {
    global.fetch = vi.fn(() => new Promise(() => {})) as unknown as typeof fetch // never resolves

    renderLayout()

    expect(screen.getByRole("status")).toBeDefined()
    expect(screen.queryByText(CHILD)).toBeNull()
    expect(screen.queryByText(DENIED)).toBeNull()
  })

  it("renders children when the check says isAdmin: true", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { isAdmin: true } }),
    }) as unknown as typeof fetch

    renderLayout()

    await screen.findByText(CHILD)
    expect(screen.queryByText(DENIED)).toBeNull()
  })

  it("renders AdminAccessDenied (not children) when isAdmin: false", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { isAdmin: false } }),
    }) as unknown as typeof fetch

    renderLayout()

    await screen.findByText(DENIED)
    expect(screen.queryByText(CHILD)).toBeNull()
  })

  it("fail-closed: a rejected check renders AdminAccessDenied, never children", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch

    renderLayout()

    await screen.findByText(DENIED)
    expect(screen.queryByText(CHILD)).toBeNull()
  })

  it("fail-closed: a non-ok check response renders AdminAccessDenied, never children", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch

    renderLayout()

    await screen.findByText(DENIED)
    expect(screen.queryByText(CHILD)).toBeNull()
  })
})
