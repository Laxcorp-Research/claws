import { readFileSync } from "fs"
import { join } from "path"
import { describe, expect, it } from "vitest"

const root = process.cwd()

function read(rel: string) {
  return readFileSync(join(root, rel), "utf8")
}

/**
 * Collision + portal locks for hand-rolled → Radix dropdown sweep.
 * MUTATION: remove Portal wrapper or avoidCollisions from dropdown-menu.tsx
 * → this fails (and bottom-row Playwright fails at runtime).
 */
describe("dropdown collision / portal guards", () => {
  it("DropdownMenuContent portals and keeps avoidCollisions", () => {
    const src = read("src/components/ui/dropdown-menu.tsx")
    expect(src).toContain("DropdownMenuPrimitive.Portal")
    expect(src).toContain("collisionPadding")
    // Enabled collision (bare prop). MUTATION: avoidCollisions={false} → fail.
    expect(src.includes("avoidCollisions={false}")).toBe(false)
    expect(src).toMatch(/avoidCollisions\r?\n/)
  })

  it("My Claws workspace menu uses DropdownMenuContent (not absolute top offset)", () => {
    const src = read("src/components/my-claws/workspace-context-menu.tsx")
    expect(src).toContain('from "@/components/ui/dropdown-menu"')
    expect(src).toContain("DropdownMenuContent")
    expect(src).toContain("collisionPadding")
    expect(src).not.toContain("absolute right-0 top-[calc(100%+4px)]")
  })

  it("top-bar + marketplace sort use DropdownMenuContent", () => {
    const top = read("src/components/shared/top-bar.tsx")
    const store = read("src/components/marketplace/marketplace-filters.tsx")
    expect(top).toContain("DropdownMenuContent")
    expect(store).toContain("DropdownMenuContent")
    expect(top).not.toContain("absolute right-0 top-full")
    expect(store).not.toContain("absolute right-0 top-full")
  })

  it("Select listbox is portal-rendered with data-side flip", () => {
    const src = read("src/components/ui/select.tsx")
    expect(src).toContain("createPortal")
    expect(src).toContain('data-side={pos.side}')
    expect(src).not.toContain("absolute left-0 right-0 top-[calc(100%+4px)]")
  })
})
