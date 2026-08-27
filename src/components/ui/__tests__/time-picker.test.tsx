// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { TimePicker } from "@/components/ui/time-picker"

afterEach(() => cleanup())

describe("TimePicker", () => {
  it("commits odd minutes through the platform picker, not a native time input", () => {
    const onChange = vi.fn()
    render(<TimePicker value="08:00" onChange={onChange} aria-label="Run time" />)

    expect(screen.getByLabelText("Run time").tagName).toBe("BUTTON")
    expect(screen.getByLabelText("Run time").getAttribute("type")).not.toBe("time")

    fireEvent.click(screen.getByLabelText("Run time"))
    fireEvent.click(screen.getByRole("option", { name: "Hour 08" }))
    fireEvent.click(screen.getByRole("option", { name: "Minute 43" }))

    expect(onChange).toHaveBeenCalledWith("08:43")
  })

  it("Escape closes the picker", () => {
    render(<TimePicker value="08:00" onChange={() => undefined} aria-label="Run time" />)
    fireEvent.click(screen.getByLabelText("Run time"))
    expect(screen.getByRole("listbox", { name: "Hours" })).toBeTruthy()
    fireEvent.keyDown(screen.getByLabelText("Run time"), { key: "Escape" })
    expect(screen.queryByRole("listbox", { name: "Hours" })).toBeNull()
  })
})
