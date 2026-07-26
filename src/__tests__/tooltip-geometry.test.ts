import { describe, expect, it } from "vitest"
import { nearestEdgeDistance } from "../../e2e/helpers/tooltip-geometry"

describe("nearestEdgeDistance (geometry helper)", () => {
  it("returns 0 when boxes overlap", () => {
    expect(
      nearestEdgeDistance(
        { x: 0, y: 0, width: 40, height: 20 },
        { x: 10, y: 5, width: 40, height: 20 },
      ),
    ).toBe(0)
  })

  it("returns vertical gap for tip above trigger", () => {
    expect(
      nearestEdgeDistance(
        { x: 10, y: 80, width: 80, height: 14 },
        { x: 10, y: 100, width: 40, height: 20 },
      ),
    ).toBe(6)
  })

  it("MUTATION-tooth: a far-away tip exceeds the 12px adjacency budget", () => {
    const gap = nearestEdgeDistance(
      { x: 500, y: 500, width: 80, height: 14 },
      { x: 10, y: 100, width: 40, height: 20 },
    )
    expect(gap).toBeGreaterThan(12)
  })
})
