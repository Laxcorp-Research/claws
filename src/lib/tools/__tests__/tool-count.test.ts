import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it, vi, beforeEach } from "vitest"
import {
  TOOL_COUNT_MARKETING_FLOOR,
  formatToolCountFloorLabel,
  getToolIntegrationCount,
} from "@/lib/tools/tool-count"

vi.mock("@/data/tool-catalog", () => ({
  ALL_TOOLS: [{ slug: "a" }, { slug: "b" }, { slug: "c" }],
}))

vi.mock("@/lib/composio-catalog", () => ({
  getComposioCatalogTools: vi.fn(),
}))

import { getComposioCatalogTools } from "@/lib/composio-catalog"

describe("formatToolCountFloorLabel", () => {
  it("floors to hundreds with + suffix", () => {
    expect(formatToolCountFloorLabel(1150)).toBe("1100+")
    expect(formatToolCountFloorLabel(1234)).toBe("1200+")
    expect(formatToolCountFloorLabel(1199)).toBe("1100+")
  })

  it("never returns below marketing floor", () => {
    expect(formatToolCountFloorLabel(500)).toBe(`${TOOL_COUNT_MARKETING_FLOOR}+`)
    expect(formatToolCountFloorLabel(0)).toBe(`${TOOL_COUNT_MARKETING_FLOOR}+`)
  })

  it("exact hundreds pass through at or above floor", () => {
    expect(formatToolCountFloorLabel(1100)).toBe("1100+")
    expect(formatToolCountFloorLabel(1500)).toBe("1500+")
  })
})

describe("getToolIntegrationCount", () => {
  beforeEach(() => {
    vi.mocked(getComposioCatalogTools).mockReset()
  })

  it("sums ALL_TOOLS length and composio catalog length", async () => {
    vi.mocked(getComposioCatalogTools).mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({ slug: `c-${i}` })) as never,
    )
    await expect(getToolIntegrationCount()).resolves.toBe(8)
  })
})

describe("tool count marketing copy guard", () => {
  function walkSrc(dir: string, acc: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) {
        if (name === "node_modules" || name === ".next" || name === "__tests__") continue
        walkSrc(p, acc)
      } else if (/\.(tsx?|jsx?)$/.test(name) && !name.endsWith(".test.ts") && !name.endsWith(".test.tsx")) {
        acc.push(p)
      }
    }
    return acc
  }

  it("MUTATION: src must not contain hardcoded 500+ tool integrations", () => {
    const hits = walkSrc(join(process.cwd(), "src")).filter((file) =>
      readFileSync(file, "utf8").includes("500+ tool"),
    )
    expect(hits).toEqual([])
  })
})
