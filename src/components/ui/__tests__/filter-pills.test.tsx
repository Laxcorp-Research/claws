// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { FilterPills } from "@/components/ui/filter-pills"

describe("FilterPills", () => {
  beforeEach(() => {
    // jsdom lacks scrollIntoView - stub for PR-5 preselect scroll.
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: vi.fn(),
    })
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it("maps vertical mouse wheel movement to horizontal scroll", () => {
    render(
      <FilterPills
        value=""
        onChange={() => {}}
        options={Array.from({ length: 20 }, (_, i) => ({ value: String(i), label: `Category ${i}` }))}
      />,
    )

    const firstPill = screen.getByRole("button", { name: "Category 0" })
    const scroller = firstPill.parentElement as HTMLDivElement
    scroller.scrollLeft = 0

    fireEvent.wheel(scroller, { deltaY: 80, deltaX: 0 })

    expect(scroller.scrollLeft).toBe(80)
  })

  it("calls onChange when a pill is clicked", () => {
    const onChange = vi.fn()
    render(
      <FilterPills
        value=""
        onChange={onChange}
        options={[{ value: "", label: "All" }, { value: "CRM", label: "CRM" }]}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "CRM" }))
    expect(onChange).toHaveBeenCalledWith("CRM")
  })

  it("clicking the active category pill clears back to All", () => {
    const onChange = vi.fn()
    render(
      <FilterPills
        value="CRM"
        onChange={onChange}
        options={[
          { value: "All", label: "All" },
          { value: "CRM", label: "CRM" },
          { value: "EMAIL", label: "Email" },
        ]}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "CRM" }))
    expect(onChange).toHaveBeenCalledWith("All")
  })

  it("pins the All pill with sticky positioning", () => {
    render(
      <FilterPills
        value="All"
        onChange={() => {}}
        options={[
          { value: "All", label: "All" },
          { value: "CRM", label: "CRM" },
        ]}
      />,
    )

    const all = screen.getByRole("button", { name: "All" })
    expect(all.getAttribute("data-sticky-all")).toBe("true")
    expect(all.className).toContain("sticky")
  })

  it("scrolls the preselected active pill into view (centered)", () => {
    const scrollIntoView = vi.fn()
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    })

    const options = Array.from({ length: 24 }, (_, i) => ({
      value: `cat-${i}`,
      label: `Category ${i}`,
    }))

    render(
      <FilterPills
        value="cat-18"
        onChange={() => {}}
        options={options}
      />,
    )

    const active = screen.getByRole("button", { name: "Category 18" })
    expect(active.getAttribute("data-active")).toBe("true")
    expect(scrollIntoView).toHaveBeenCalled()
    expect(scrollIntoView.mock.calls[0][0]).toEqual(
      expect.objectContaining({ inline: "center", block: "nearest" }),
    )
  })
})
