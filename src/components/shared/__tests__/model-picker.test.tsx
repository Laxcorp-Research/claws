// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ModelPicker } from "@/components/shared/model-picker"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function mockCatalog(options: Array<{ value: string; label: string; provider?: string }>) {
  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({ success: true, data: { options } }),
  })) as unknown as typeof fetch
}

describe("ModelPicker reads ModelCatalogEntry registry", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("registry row added → appears in picker", async () => {
    mockCatalog([
      { value: "anthropic/claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", provider: "Anthropic" },
      { value: "anthropic/claude-sonnet-4-6", label: "Claude Sonnet 4.6", provider: "Anthropic" },
      { value: "anthropic/claude-opus-4-6", label: "Claude Opus 4.6", provider: "Anthropic" },
      { value: "anthropic/claude-sonnet-4-7", label: "Claude Sonnet 4.7", provider: "Anthropic" },
    ])

    render(
      <ModelPicker
        value="anthropic/claude-haiku-4-5-20251001"
        onChange={() => {}}
        creditMode
      />,
    )

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled()
    })
    const url = String(vi.mocked(global.fetch).mock.calls[0]?.[0])
    expect(url).toContain("/api/models/catalog")

    await userEvent.click(screen.getByRole("button", { expanded: false }))
    expect(await screen.findByRole("option", { name: /Claude Sonnet 4\.7/ })).toBeDefined()
  })

  it("MUTATION: static-list restored → fails", () => {
    const src = readFileSync(join(process.cwd(), "src/components/shared/model-picker.tsx"), "utf8")
    expect(src).toContain("/api/models/catalog")
    expect(src).not.toMatch(/import\s*\{[^}]*AI_MODELS/)
    expect(src).not.toMatch(/from ["']@\/lib\/models["']/)
    expect(src).not.toMatch(/from ["']@\/lib\/models\/seed-models["']/)
    expect(src).not.toMatch(/claude-haiku-4-5/)
    expect(src).not.toMatch(/Claude Haiku 4\.5/)
    expect(src).not.toContain("BYOK cost figures are estimates")
    expect(src).not.toContain("setHonesty")
  })
})
