// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ModelPicker } from "@/components/shared/model-picker"
import { resetModelCatalogCache } from "@/hooks/use-model-catalog"
import { looksLikeModelSlug } from "@/lib/models/humanize"

afterEach(() => {
  cleanup()
  resetModelCatalogCache()
  vi.restoreAllMocks()
})

type CatalogRow = {
  modelId: string
  displayName: string
  provider: string
  isPinned?: boolean
}

function mockCatalog(models: CatalogRow[]) {
  global.fetch = vi.fn(async () => ({
    ok: true,
    json: async () => ({
      success: true,
      data: {
        models,
        options: models.map((m) => ({
          value: m.modelId,
          label: m.displayName,
          provider: m.provider,
        })),
      },
    }),
  })) as unknown as typeof fetch
}

function nativePins(): CatalogRow[] {
  return [
    {
      modelId: "anthropic/claude-haiku-4-5-20251001",
      displayName: "Claude Haiku 4.5",
      provider: "ANTHROPIC",
      isPinned: true,
    },
    {
      modelId: "anthropic/claude-sonnet-4-7",
      displayName: "Claude Sonnet 4.7",
      provider: "ANTHROPIC",
      isPinned: true,
    },
    { modelId: "openai/gpt-4o", displayName: "GPT-4o", provider: "OPENAI", isPinned: true },
    {
      modelId: "openrouter/openai/gpt-4o-mini",
      displayName: "GPT-4o Mini",
      provider: "OPENROUTER",
      isPinned: true,
    },
  ]
}

function fatCatalog(extra = 420): CatalogRow[] {
  const rows = nativePins()
  for (let i = 0; i < extra; i++) {
    rows.push({
      modelId: `openrouter/vendor/model-${i}`,
      displayName: i === 77 ? "Needle Unique Model" : `Catalog Model ${i}`,
      provider: "OPENROUTER",
      isPinned: false,
    })
  }
  return rows
}

async function openPicker() {
  await waitFor(() => {
    expect(global.fetch).toHaveBeenCalled()
  })
  await userEvent.click(screen.getByTestId("model-combobox-trigger"))
  expect(await screen.findByTestId("model-combobox-popover")).toBeDefined()
}

describe("ModelPicker combobox", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetModelCatalogCache()
  })

  it("registry row added → appears in picker", async () => {
    mockCatalog(nativePins())
    render(
      <ModelPicker
        value="anthropic/claude-haiku-4-5-20251001"
        onChange={() => {}}
        creditMode
      />,
    )
    await openPicker()
    expect(await screen.findByRole("option", { name: /Claude Sonnet 4\.7/ })).toBeDefined()
  })

  it("closed trigger never renders a raw slug", async () => {
    mockCatalog([
      {
        modelId: "openrouter/meta-llama/llama-3.3-70b-instruct",
        displayName: "",
        provider: "OPENROUTER",
        isPinned: false,
      },
    ])
    render(
      <ModelPicker value="openrouter/meta-llama/llama-3.3-70b-instruct" onChange={() => {}} />,
    )
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    const trigger = screen.getByTestId("model-combobox-trigger")
    expect(looksLikeModelSlug(trigger.textContent ?? "")).toBe(false)
    expect(trigger.textContent).not.toContain("openrouter/")
    expect(trigger.textContent).toMatch(/Llama/i)
  })

  it("virtualizes a 400+ catalog and type-to-filters across it", async () => {
    mockCatalog(fatCatalog())
    render(
      <ModelPicker
        value="anthropic/claude-haiku-4-5-20251001"
        onChange={() => {}}
        creditMode
        configuredProviders={["OPENROUTER"]}
      />,
    )
    await openPicker()
    const list = screen.getByTestId("model-combobox-list")
    expect(list.getAttribute("data-virtualized")).toBe("true")
    expect(screen.getAllByRole("option").length).toBeLessThan(80)

    await userEvent.type(screen.getByTestId("model-combobox-filter"), "Needle Unique")
    expect(await screen.findByRole("option", { name: /Needle Unique Model/ })).toBeDefined()
    expect(screen.getAllByRole("option").length).toBe(1)
  })

  it("enablement matrix: credits-only / +OpenRouter / none", async () => {
    mockCatalog(nativePins())

    const { unmount } = render(
      <ModelPicker
        value="anthropic/claude-haiku-4-5-20251001"
        onChange={() => {}}
        creditMode
        configuredProviders={[]}
      />,
    )
    await openPicker()
    const sonnet = screen.getByRole("option", { name: /Claude Sonnet 4\.7/ })
    expect((sonnet as HTMLButtonElement).disabled).toBe(false)
    const gpt = screen.getByRole("option", { name: /GPT-4o \(OpenAI\)/ })
    expect((gpt as HTMLButtonElement).disabled).toBe(true)
    expect(within(gpt).getByText(/OpenAI key/)).toBeDefined()
    unmount()
    resetModelCatalogCache()

    mockCatalog(nativePins())
    const second = render(
      <ModelPicker
        value="anthropic/claude-haiku-4-5-20251001"
        onChange={() => {}}
        creditMode
        configuredProviders={["OPENROUTER"]}
      />,
    )
    await openPicker()
    expect((screen.getByRole("option", { name: /GPT-4o Mini \(OpenRouter\)/ }) as HTMLButtonElement).disabled).toBe(false)
    second.unmount()
    resetModelCatalogCache()

    mockCatalog(nativePins())
    render(
      <ModelPicker
        value="anthropic/claude-haiku-4-5-20251001"
        onChange={() => {}}
        creditMode={false}
        configuredProviders={[]}
      />,
    )
    await openPicker()
    expect((screen.getByRole("option", { name: /Claude Sonnet 4\.7/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByTestId("model-auth-warning").textContent).toMatch(/No auth path for Anthropic/)
  })

  it("MUTATION: static-list or second catalog search input restored → fails", () => {
    const src = readFileSync(join(process.cwd(), "src/components/shared/model-picker.tsx"), "utf8")
    const combo = readFileSync(join(process.cwd(), "src/components/ui/combobox.tsx"), "utf8")
    expect(src).toContain("useModelCatalog")
    expect(src).not.toMatch(/import\s*\{[^}]*AI_MODELS/)
    expect(src).not.toMatch(/from ["']@\/lib\/models["']/)
    expect(src).not.toMatch(/from ["']@\/lib\/models\/seed-models["']/)
    expect(src).not.toMatch(/claude-haiku-4-5/)
    expect(src).not.toContain("Search full catalog")
    expect(src).not.toContain("Search Claude models")
    expect(src).not.toMatch(/<Input/)
    const hook = readFileSync(join(process.cwd(), "src/hooks/use-model-catalog.ts"), "utf8")
    expect(hook).toContain("/api/models/catalog")
    expect(combo).not.toContain("Search full catalog")
    expect(combo).not.toContain("Search Claude models")
  })
})
