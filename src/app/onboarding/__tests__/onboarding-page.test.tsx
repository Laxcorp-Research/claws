// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { OnboardingClient } from "@/components/onboarding/onboarding-client"

const update = vi.fn()
const showSnackbar = vi.fn()
const assign = vi.fn()

vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { onboardingCompleted: false, user: { id: "u1" } },
    status: "authenticated",
    update,
  }),
}))

vi.mock("@/components/shared/snackbar", () => ({
  useSnackbarOptional: () => ({ show: showSnackbar, dismiss: vi.fn() }),
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  update.mockReset()
  showSnackbar.mockReset()
  assign.mockReset()
})

beforeEach(() => {
  update.mockResolvedValue({ onboardingCompleted: true })
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, assign },
  })
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (String(url).includes("/api/workspaces")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { id: "ws-new" } }),
        })
      }
      if (String(url).includes("/api/user/complete-onboarding")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { onboardingCompleted: true } }),
        })
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    }) as unknown as typeof fetch,
  )
})

describe("OnboardingClient Batch B CTAs", () => {
  it("Add Anthropic/OpenAI key links to /settings?tab=api-keys when no key", () => {
    render(<OnboardingClient hasApiKey={false} />)
    expect(screen.getByText("Add Anthropic key").closest("a")?.getAttribute("href")).toBe(
      "/settings?tab=api-keys",
    )
  })

  it("marks step 1 done when hasApiKey is true (no add-key CTAs)", () => {
    render(<OnboardingClient hasApiKey={true} />)
    expect(screen.queryByText("Add Anthropic key")).toBeNull()
  })

  it("shows Anthropic template honesty hint when another provider key exists", () => {
    render(<OnboardingClient hasApiKey={true} showAnthropicTemplateHint />)
    expect(
      screen.getByText(
        /Templates are engineered for Claude models — add an Anthropic key/,
      ),
    ).toBeTruthy()
    expect(screen.getByText("Add Anthropic key")).toBeTruthy()
  })

  it("Create custom Claw POSTs workspace then hard-navigates to builder", async () => {
    render(<OnboardingClient hasApiKey={false} />)
    fireEvent.click(screen.getByText("Create custom Claw"))
    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith("/builder/ws-new")
    })
    expect(fetch).toHaveBeenCalledWith(
      "/api/user/complete-onboarding",
      expect.objectContaining({ method: "POST" }),
    )
  })

  it("does not navigate when complete-onboarding is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (String(url).includes("/api/workspaces")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ success: true, data: { id: "ws-new" } }),
          })
        }
        if (String(url).includes("/api/user/complete-onboarding")) {
          return Promise.resolve({
            ok: false,
            json: () => Promise.resolve({ error: { message: "Unauthorized" } }),
          })
        }
        return Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
      }) as unknown as typeof fetch,
    )
    render(<OnboardingClient hasApiKey={false} />)
    fireEvent.click(screen.getByText("Create custom Claw"))
    await waitFor(() => {
      expect(showSnackbar).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "error" }),
      )
    })
    expect(assign).not.toHaveBeenCalled()
  })

  it("Skip hard-navigates after successful complete-onboarding", async () => {
    render(<OnboardingClient hasApiKey={false} />)
    fireEvent.click(screen.getByText("Skip onboarding →"))
    await waitFor(() => {
      expect(assign).toHaveBeenCalledWith("/my-claws")
    })
  })

  it("source: complete-onboarding route + AbortSignal.timeout + mutateWithFeedback", async () => {
    const { readFileSync } = await import("node:fs")
    const { join } = await import("node:path")
    const client = readFileSync(
      join(process.cwd(), "src/components/onboarding/onboarding-client.tsx"),
      "utf8",
    )
    expect(client).toContain("/api/user/complete-onboarding")
    expect(client).toContain("AbortSignal.timeout(15_000)")
    expect(client).toContain("mutateWithFeedback")
    expect(client).toContain("window.location.assign")
    const route = readFileSync(
      join(process.cwd(), "src/app/api/user/complete-onboarding/route.ts"),
      "utf8",
    )
    expect(route).toContain("encode(")
    expect(route).toContain("onboardingCompleted: true")
  })
})
