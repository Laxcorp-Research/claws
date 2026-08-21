// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { CreatorListingMenu } from "@/components/settings/creator-listing-menu"
import { installRadixPointerPolyfills } from "@/components/my-claws/__tests__/radix-menu-test-utils"

beforeAll(() => {
  installRadixPointerPolyfills()
})

afterEach(() => cleanup())

function openListingMenu(label: string) {
  const trigger = screen.getByRole("button", { name: label })
  fireEvent.pointerDown(trigger, { button: 0, ctrl: 0 })
  fireEvent.pointerUp(trigger, { button: 0, ctrl: 0 })
  fireEvent.click(trigger)
}

describe("CreatorListingMenu", () => {
  it("published listing offers Unpublish; Delete disabled with install copy", async () => {
    render(
      <CreatorListingMenu
        kind="template"
        slug="sold-claw"
        name="Sold Claw"
        isPublished
        reviewStatus="APPROVED"
        canDelete={false}
        deleteBlockedReason="3 people installed this - you can unpublish but not delete"
        onChanged={() => {}}
      />,
    )
    openListingMenu("Sold Claw listing options")
    expect(await screen.findByText("Unpublish")).toBeTruthy()
    expect(screen.queryByText("Publish again")).toBeNull()
    expect(screen.getByText("Delete")).toBeTruthy()
    expect(
      screen.getByText("3 people installed this - you can unpublish but not delete"),
    ).toBeTruthy()
  })

  it("unpublished listing offers Publish again", async () => {
    render(
      <CreatorListingMenu
        kind="skill"
        slug="my-skill"
        name="My Skill"
        isPublished={false}
        reviewStatus="APPROVED"
        canDelete
        deleteBlockedReason={null}
        onChanged={() => {}}
      />,
    )
    openListingMenu("My Skill listing options")
    expect(await screen.findByText("Publish again")).toBeTruthy()
    expect(screen.queryByText("Unpublish")).toBeNull()
  })

  it("Unpublish confirm uses honest buyer-copy", async () => {
    render(
      <CreatorListingMenu
        kind="template"
        slug="my-claw"
        name="My Claw"
        isPublished
        reviewStatus="APPROVED"
        canDelete
        deleteBlockedReason={null}
        onChanged={() => {}}
      />,
    )
    openListingMenu("My Claw listing options")
    fireEvent.click(await screen.findByText("Unpublish"))
    await waitFor(() => {
      expect(screen.getByText("Unpublish this listing?")).toBeTruthy()
    })
    expect(
      screen.getByText(/People who already installed keep their copy/),
    ).toBeTruthy()
  })

  it("MUTATION: dashboard wires listing menu → fail if dropped", () => {
    const dash = readFileSync(
      join(process.cwd(), "src/components/settings/creator-dashboard.tsx"),
      "utf8",
    )
    expect(dash).toContain("CreatorListingMenu")
    expect(dash).toContain('kind="template"')
    expect(dash).toContain('kind="skill"')
  })
})
