// @vitest-environment jsdom
//
// a11y fix: the destructive (danger) Button must use the --danger token
// (#dc2626, AA with white text in both modes), NOT --err (which stays light in
// dark mode for error TEXT and fails as a button bg, ~2.64:1). Mutation guard:
// revert the danger variant to bg-[var(--err)] and this fails.

import { describe, it, expect, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import { Button } from "@/components/ui/button"

afterEach(() => cleanup())

describe("Button danger variant token", () => {
  it("renders the danger background from --danger, with white text", () => {
    render(<Button variant="danger">Delete</Button>)
    const btn = screen.getByRole("button", { name: "Delete" })
    expect(btn.className).toContain("bg-[var(--danger)]")
    expect(btn.className).toContain("text-white")
    expect(btn.className).not.toContain("bg-[var(--err)]")
  })
})
