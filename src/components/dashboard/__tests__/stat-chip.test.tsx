// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { StatChip } from "@/components/dashboard/stat-chip"

afterEach(() => cleanup())

describe("StatChip", () => {
  it("renders the label through truncation-ready text", () => {
    render(<StatChip label="Very long stat chip label" value="42" />)
    expect(screen.getByText("Very long stat chip label").className).toContain("truncate")
  })
})
