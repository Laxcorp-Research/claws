import { describe, expect, it } from "vitest"
import {
  THINKING_LEVELS,
  THINKING_LEVEL_LABEL,
  isThinkingLevel,
} from "@/lib/models/thinking"

describe("thinking levels (runtime contract)", () => {
  it("matches OpenClaw's thinkingDefault levels exactly, in order", () => {
    // Runtime source of truth: control-ui sessions bundle `h=[off,minimal,low,medium,high]`
    // and config key agents.list[].thinkingDefault. Reordering or renaming breaks
    // generated configs.
    expect(THINKING_LEVELS).toEqual(["off", "minimal", "low", "medium", "high"])
  })

  it("isThinkingLevel accepts every level and rejects everything else", () => {
    for (const level of THINKING_LEVELS) {
      expect(isThinkingLevel(level)).toBe(true)
      expect(THINKING_LEVEL_LABEL[level].length).toBeGreaterThan(0)
    }
    expect(isThinkingLevel(null)).toBe(false)
    expect(isThinkingLevel(undefined)).toBe(false)
    expect(isThinkingLevel("")).toBe(false)
    expect(isThinkingLevel("default")).toBe(false)
    expect(isThinkingLevel("ultra")).toBe(false)
    expect(isThinkingLevel("HIGH")).toBe(false)
  })
})
