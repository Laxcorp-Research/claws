// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { HttpActionCard } from "@/components/dashboard/http-action-card"

vi.mock("@/components/shared/snackbar", () => ({
  useSnackbarOptional: () => ({ show: vi.fn() }),
}))

afterEach(() => cleanup())

const card = {
  skill: "alpaca-trading",
  method: "POST",
  host: "paper-api.alpaca.markets",
  path: "/v2/orders",
  bodyPlain: "BUY 166 MU @ $1,017 stop $1,005",
}

describe("HttpActionCard", () => {
  it("renders skill, method, host, path, and body before Approve", () => {
    render(
      <HttpActionCard
        workspaceId="ws-1"
        humanRequestId="hr-1"
        timestamp="2026-09-07T00:00:00.000Z"
        card={card}
      />,
    )
    expect(screen.getByText("alpaca-trading")).toBeTruthy()
    expect(screen.getByText("POST")).toBeTruthy()
    expect(screen.getByText("paper-api.alpaca.markets")).toBeTruthy()
    expect(screen.getByText("/v2/orders")).toBeTruthy()
    expect(screen.getByTestId("http-action-body").textContent).toBe(
      "BUY 166 MU @ $1,017 stop $1,005",
    )
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy()
  })

  it("MUTATION: payload-less card cannot approve", () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    render(
      <HttpActionCard
        workspaceId="ws-1"
        humanRequestId="hr-1"
        timestamp="2026-09-07T00:00:00.000Z"
        card={{ ...card, bodyPlain: "" }}
      />,
    )
    const approve = screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement
    expect(approve.disabled).toBe(true)
    expect(screen.getByTestId("http-action-violations").textContent).toMatch(/missing/)
    fireEvent.click(approve)
    expect(fetchMock).not.toHaveBeenCalled()
    vi.unstubAllGlobals()
  })
})
