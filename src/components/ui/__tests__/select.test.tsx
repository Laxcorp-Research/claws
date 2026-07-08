// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Select } from "@/components/ui/select"

afterEach(() => cleanup())

describe("Select", () => {
  it("supports keyboard navigation and selection", () => {
    const onValueChange = vi.fn()
    render(
      <Select
        value="today"
        onValueChange={onValueChange}
        options={[
          { value: "today", label: "Today" },
          { value: "7d", label: "7d" },
          { value: "all", label: "All" },
        ]}
      />,
    )

    const trigger = screen.getByRole("button")
    fireEvent.keyDown(trigger, { key: "ArrowDown" })
    fireEvent.keyDown(trigger, { key: "Enter" })

    expect(onValueChange).toHaveBeenCalledWith("7d")
  })

  it("supports type-ahead", () => {
    const onValueChange = vi.fn()
    render(
      <Select
        value=""
        onValueChange={onValueChange}
        options={[
          { value: "webchat", label: "Webchat" },
          { value: "slack", label: "Slack" },
        ]}
      />,
    )

    const trigger = screen.getByRole("button")
    fireEvent.keyDown(trigger, { key: "s" })
    fireEvent.keyDown(trigger, { key: "Enter" })

    expect(onValueChange).toHaveBeenCalledWith("slack")
  })
})
