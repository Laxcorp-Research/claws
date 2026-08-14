// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { BYOK_COST_DISCLAIMER } from "@/lib/models/byok-disclaimer"
import { ModelSelectionTable } from "@/components/setup/model-selection-table"

vi.mock("@/components/shared/model-picker", () => ({
  ModelPicker: () => <div data-testid="model-picker" />,
}))

afterEach(() => cleanup())

const AGENTS = [
  { id: "a1", name: "Commander", role: "ORCHESTRATOR" as const, model: "anthropic/claude-haiku-4-5-20251001" },
  { id: "a2", name: "Scout", role: "WORKER" as const, model: "anthropic/claude-sonnet-4-6" },
  { id: "a3", name: "Gate", role: "CRITIC" as const, model: "anthropic/claude-opus-4-6" },
]

describe("ModelSelectionTable BYOK disclaimer placement", () => {
  it("omits the line in credit-mode with no BYOK keys", () => {
    render(
      <ModelSelectionTable
        agents={AGENTS}
        onModelChange={() => {}}
        creditMode
        configuredProviders={["ANTHROPIC"]}
      />,
    )
    expect(screen.queryByTestId("byok-cost-disclaimer")).toBeNull()
    expect(screen.queryByText(BYOK_COST_DISCLAIMER)).toBeNull()
  })

  it("renders exactly one line above the table when BYOK is relevant", () => {
    render(
      <ModelSelectionTable
        agents={[
          ...AGENTS,
          { id: "a4", name: "Scout+", role: "WORKER", model: "openai/gpt-4o" },
        ]}
        onModelChange={() => {}}
        creditMode
        configuredProviders={["ANTHROPIC", "OPENAI"]}
      />,
    )
    const lines = screen.getAllByTestId("byok-cost-disclaimer")
    expect(lines).toHaveLength(1)
    expect(lines[0]?.textContent).toBe(BYOK_COST_DISCLAIMER)
    const table = screen.getByRole("table")
    expect(lines[0] && lines[0].compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("MUTATION: per-row disclaimer restored → fails", () => {
    const table = readFileSync(
      join(process.cwd(), "src/components/setup/model-selection-table.tsx"),
      "utf8",
    )
    const picker = readFileSync(
      join(process.cwd(), "src/components/shared/model-picker.tsx"),
      "utf8",
    )
    expect(table).toContain("data-testid=\"byok-cost-disclaimer\"")
    expect(table).toContain("shouldShowByokCostDisclaimer")
    expect(picker).not.toContain("cost figures are estimates")
    expect(picker).not.toContain("setHonesty")
    expect(table.split("BYOK_COST_DISCLAIMER").length - 1).toBe(2)
  })
})
