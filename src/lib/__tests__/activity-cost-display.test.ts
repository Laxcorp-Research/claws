import { describe, expect, it } from "vitest"
import {
  aggregateAgentCostRow,
  formatCostDisplay,
  resolveAgentCostWindow,
  resolveWindowCost,
  sinceForCostRange,
  utcDayStart,
} from "@/lib/activity-cost-display"
import { getModelCost } from "@/lib/models"

describe("utcDayStart / sinceForCostRange (rule 18)", () => {
  it("uses UTC midnight - not local Date(y,m,d)", () => {
    const now = new Date("2026-07-14T03:15:00.000Z")
    expect(utcDayStart(now).toISOString()).toBe("2026-07-14T00:00:00.000Z")
    expect(sinceForCostRange("today", now)?.toISOString()).toBe("2026-07-14T00:00:00.000Z")
    expect(sinceForCostRange("all", now)).toBeNull()
    const week = sinceForCostRange("7d", now)!
    expect(week.getTime()).toBe(now.getTime() - 7 * 86_400_000)
  })
})

describe("aggregateAgentCostRow", () => {
  it("sums all-real MESSAGE_SENT without estimate", () => {
    const resolved = aggregateAgentCostRow({
      model: "anthropic/claude-haiku-4-5-20251001",
      taskCompleteCalls: 2,
      messageSents: [{ apiCost: 0.01 }, { apiCost: 0.02 }],
    })
    expect(resolved).toEqual({ calls: 2, cost: 0.03, isEstimate: false })
  })

  it("MUTATION-anchored: mixed MESSAGE_SENT stays estimate", () => {
    const resolved = aggregateAgentCostRow({
      model: "anthropic/claude-haiku-4-5-20251001",
      taskCompleteCalls: 2,
      messageSents: [{ apiCost: 0.01 }, { apiCost: null }],
    })
    expect(resolved.isEstimate).toBe(true)
  })
})

describe("resolveWindowCost", () => {
  it("sums real apiCost when every constituent row has one", () => {
    const resolved = resolveWindowCost([{ apiCost: 0.01 }, { apiCost: 0.02 }], 9.99)
    expect(resolved).toEqual({ cost: 0.03, isEstimate: false })
  })

  it("MUTATION-anchored: mixed windows stay estimates (partial-real ≠ real)", () => {
    const resolved = resolveWindowCost([{ apiCost: 0.01 }, { apiCost: null }], 1.5)
    // Dropping the allReal / mixed check (always treating as real) must fail.
    expect(resolved.isEstimate).toBe(true)
    expect(resolved.cost).toBe(1.5)
  })

  it("uses estimated fallback when no row has apiCost", () => {
    const resolved = resolveWindowCost([{ apiCost: null }, { apiCost: null }], 0.45)
    expect(resolved).toEqual({ cost: 0.45, isEstimate: true })
  })
})

describe("resolveAgentCostWindow", () => {
  const model = "anthropic/claude-haiku-4-5-20251001"
  const base = {
    agentSlug: "orchestrator",
    model,
    sinceMs: Date.parse("2026-07-13T00:00:00.000Z"),
  }

  it("labels fully-real MESSAGE_SENT windows without estimate", () => {
    const resolved = resolveAgentCostWindow({
      ...base,
      rows: [
        {
          agentSlug: "orchestrator",
          actionType: "MESSAGE_SENT",
          timestamp: "2026-07-13T08:00:00.000Z",
          apiCost: 0.004,
        },
        {
          agentSlug: "orchestrator",
          actionType: "TASK_COMPLETE",
          timestamp: "2026-07-13T08:00:01.000Z",
          apiCost: null,
        },
      ],
    })
    expect(resolved.isEstimate).toBe(false)
    expect(resolved.cost).toBe(0.004)
    expect(resolved.calls).toBe(1)
  })

  it("MUTATION-anchored: mixed MESSAGE_SENT apiCost stays labeled estimate", () => {
    const resolved = resolveAgentCostWindow({
      ...base,
      rows: [
        {
          agentSlug: "orchestrator",
          actionType: "MESSAGE_SENT",
          timestamp: "2026-07-13T08:00:00.000Z",
          apiCost: 0.004,
        },
        {
          agentSlug: "orchestrator",
          actionType: "MESSAGE_SENT",
          timestamp: "2026-07-13T09:00:00.000Z",
          apiCost: null,
        },
        {
          agentSlug: "orchestrator",
          actionType: "TASK_COMPLETE",
          timestamp: "2026-07-13T09:00:01.000Z",
          apiCost: null,
        },
      ],
    })
    expect(resolved.isEstimate).toBe(true)
    expect(resolved.cost).toBe(getModelCost(model))
  })
})

describe("formatCostDisplay", () => {
  const formatCurrency = (n: number) => `$${n.toFixed(2)}`

  it("renders em dash with no activity (K1 never-$0.00)", () => {
    expect(
      formatCostDisplay(0, { isEstimate: true, hasActivity: false, formatCurrency }),
    ).toBe("-")
  })

  it("omits est. label for fully-real windows", () => {
    expect(
      formatCostDisplay(1.23, { isEstimate: false, hasActivity: true, formatCurrency }),
    ).toBe("$1.23")
  })

  it("keeps est. label for estimated windows", () => {
    expect(
      formatCostDisplay(1.23, { isEstimate: true, hasActivity: true, formatCurrency }),
    ).toBe("~$1.23 est.")
  })
})
