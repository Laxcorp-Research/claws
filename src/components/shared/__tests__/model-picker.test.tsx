// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { existsSync, readFileSync } from "node:fs"
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
  contextLength?: number | null
  pricingSnippet?: string | null
  costPer1kEst?: number | null
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
      pricingSnippet: "$3.00/$15.00 per 1M tok",
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

async function openModal() {
  await waitFor(() => {
    expect(global.fetch).toHaveBeenCalled()
  })
  await userEvent.click(screen.getByTestId("model-picker-trigger"))
  expect(await screen.findByRole("dialog")).toBeDefined()
}

describe("ModelPicker — button + modal", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetModelCatalogCache()
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
    const trigger = screen.getByTestId("model-picker-trigger")
    expect(looksLikeModelSlug(trigger.textContent ?? "")).toBe(false)
    expect(trigger.textContent).not.toContain("openrouter/")
    expect(trigger.textContent).toMatch(/Llama/i)
  })

  it("trigger opens a dialog with all four provider tabs; current provider preselected", async () => {
    mockCatalog(nativePins())
    render(
      <ModelPicker value="anthropic/claude-haiku-4-5-20251001" onChange={() => {}} creditMode />,
    )
    await openModal()
    for (const tab of ["ANTHROPIC", "OPENAI", "GOOGLE", "OPENROUTER"]) {
      expect(screen.getByTestId(`model-modal-tab-${tab}`)).toBeDefined()
    }
    expect(screen.getByTestId("model-modal-tab-ANTHROPIC").getAttribute("aria-selected")).toBe("true")
    expect(await screen.findByRole("option", { name: /Claude Sonnet 4\.7/ })).toBeDefined()
  })

  it("virtualizes a 400+ OpenRouter catalog and search-filters across it", async () => {
    mockCatalog(fatCatalog())
    render(
      <ModelPicker
        value="anthropic/claude-haiku-4-5-20251001"
        onChange={() => {}}
        creditMode
        configuredProviders={["OPENROUTER"]}
      />,
    )
    await openModal()
    await userEvent.click(screen.getByTestId("model-modal-tab-OPENROUTER"))
    await screen.findByTestId("model-modal-list")
    // Windowed rendering: 421 OpenRouter rows exist, only a small slice mounts.
    expect(screen.getAllByRole("option").length).toBeLessThan(80)

    await userEvent.type(screen.getByTestId("model-modal-search"), "Needle Unique")
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
    await openModal()
    // Credits satisfy Anthropic: green line, rows clickable.
    expect(screen.getByTestId("model-modal-auth-line").textContent).toContain(
      "Powered by Claws credits",
    )
    const sonnet = screen.getByRole("option", { name: /Claude Sonnet 4\.7/ })
    expect((sonnet as HTMLButtonElement).disabled).toBe(false)
    // OpenAI tab: locked banner with plain unlock copy, rows disabled.
    await userEvent.click(screen.getByTestId("model-modal-tab-OPENAI"))
    expect(screen.getByTestId("model-modal-locked-banner").textContent).toContain(
      "Add an OpenAI API key to unlock these models",
    )
    expect(
      (screen.getByRole("option", { name: /GPT-4o/ }) as HTMLButtonElement).disabled,
    ).toBe(true)
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
    await openModal()
    await userEvent.click(screen.getByTestId("model-modal-tab-OPENROUTER"))
    expect(
      (screen.getByRole("option", { name: /GPT-4o Mini/ }) as HTMLButtonElement).disabled,
    ).toBe(false)
    // Locked native tab advertises the OpenRouter route (founder's exact account shape).
    await userEvent.click(screen.getByTestId("model-modal-tab-GOOGLE"))
    expect(screen.getByTestId("model-modal-locked-banner").textContent).toContain(
      "your OpenRouter key already runs Google models",
    )
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
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    // Human warning: names the fix, no "auth path" jargon.
    const warning = screen.getByTestId("model-auth-warning").textContent ?? ""
    expect(warning).toContain("No active credits on this account")
    expect(warning).toContain("add an Anthropic API key before deploy")
    expect(warning.toLowerCase()).not.toContain("auth path")
    await userEvent.click(screen.getByTestId("model-picker-trigger"))
    await screen.findByRole("dialog")
    // Selected model's provider is locked → Save disabled.
    expect((screen.getByTestId("model-modal-save") as HTMLButtonElement).disabled).toBe(true)
  })

  it("save applies model + thinking effort; untouched thinking stays null", async () => {
    mockCatalog(nativePins())
    const onChange = vi.fn()
    render(
      <ModelPicker
        value="anthropic/claude-haiku-4-5-20251001"
        onChange={onChange}
        creditMode
      />,
    )
    await openModal()
    await userEvent.click(screen.getByRole("option", { name: /Claude Sonnet 4\.7/ }))
    await userEvent.click(screen.getByTestId("model-modal-save"))
    expect(onChange).toHaveBeenCalledWith("anthropic/claude-sonnet-4-7", null)

    onChange.mockClear()
    await userEvent.click(screen.getByTestId("model-picker-trigger"))
    await screen.findByRole("dialog")
    await userEvent.click(screen.getByTestId("thinking-level-high"))
    await userEvent.click(screen.getByTestId("model-modal-save"))
    expect(onChange).toHaveBeenCalledWith("anthropic/claude-haiku-4-5-20251001", "high")
  })

  it("thinking prop preselects its segment; row shows honest price or em dash", async () => {
    mockCatalog(nativePins())
    render(
      <ModelPicker
        value="anthropic/claude-sonnet-4-7"
        thinkingDefault="medium"
        onChange={() => {}}
        creditMode
      />,
    )
    // Closed trigger surfaces the configured thinking level.
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())
    expect(screen.getByTestId("model-picker-trigger").textContent).toContain("Thinking: Medium")
    await userEvent.click(screen.getByTestId("model-picker-trigger"))
    await screen.findByRole("dialog")
    expect(screen.getByTestId("thinking-level-medium").getAttribute("aria-checked")).toBe("true")
    const priced = screen.getByRole("option", { name: /Claude Sonnet 4\.7/ })
    expect(within(priced).getByText("$3.00/$15.00 per 1M tok")).toBeDefined()
    const unpriced = screen.getByRole("option", { name: /Claude Haiku 4\.5/ })
    expect(within(unpriced).getByText("—")).toBeDefined()
  })

  it("MUTATION: inline dropdown, second search input, or static list restored → fails", () => {
    const src = readFileSync(join(process.cwd(), "src/components/shared/model-picker.tsx"), "utf8")
    expect(src).toContain("useModelCatalog")
    expect(src).toContain("ModelSelectModal")
    expect(src).not.toMatch(/import\s*\{[^}]*AI_MODELS/)
    expect(src).not.toMatch(/from ["']@\/lib\/models["']/)
    expect(src).not.toMatch(/from ["']@\/lib\/models\/seed-models["']/)
    expect(src).not.toMatch(/claude-haiku-4-5/)
    expect(src).not.toContain("Search full catalog")
    expect(src).not.toMatch(/<Input/)
    // Built without the literal tag so the repo-wide raw-select grep guard
    // (select-grep.test.ts) does not flag this test file itself.
    expect(src).not.toMatch(new RegExp("<sel" + "ect", "i"))
    expect(src).not.toContain("role=\"listbox\"")
    const hook = readFileSync(join(process.cwd(), "src/hooks/use-model-catalog.ts"), "utf8")
    expect(hook).toContain("/api/models/catalog")
  })

  it("MUTATION: deleted combobox revived → fails", () => {
    expect(existsSync(join(process.cwd(), "src/components/ui/combobox.tsx"))).toBe(false)
  })
})
