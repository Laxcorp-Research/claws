// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { ToolRow } from "@/components/setup/tool-row"

afterEach(() => cleanup())

describe("ToolRow truncation adoption", () => {
  it("renders tool names through truncation-ready text", () => {
    render(
      <ToolRow
        name="Very Long Tool Name"
        connectionStatus="connected"
        connectionType="API_KEY"
      />,
    )

    expect(screen.getByText("Very Long Tool Name").className).toContain("truncate")
  })
})
