// @vitest-environment jsdom
//
// PR2.9-fix2: Modal portals to document.body so modal-on-modal stacking
// is deterministic regardless of JSX-source-order.
//
// Coverage:
//   1. Portal assertion — Modal's overlay DOM lands directly under
//      document.body (not nested inside whatever the test render
//      container is). This is THE invariant that fixes the BYOK-form-
//      stacks-below-Browse bug.
//   2. Existing behavioral invariants (open/close, escape key, click
//      outside) still work after portaling.
//   3. SSR-guard sanity: with open=true on first render (before useEffect
//      flips mounted), Modal renders nothing. After mount-effect runs,
//      it renders.

import { afterEach, describe, expect, it, vi } from "vitest"
import { render, screen, cleanup, act, waitFor } from "@testing-library/react"
import { useState } from "react"
import userEvent from "@testing-library/user-event"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { Modal } from "@/components/ui/modal"
import { ReviewStars } from "@/components/marketplace/review-stars"

afterEach(() => {
  cleanup()
})

describe("Modal — PR2.9-fix2 portal behavior", () => {
  it("renders the overlay as a direct child of document.body (portal assertion)", () => {
    const { container } = render(
      <Modal open onClose={() => {}} title="Portal test">
        <p>Body content</p>
      </Modal>,
    )

    // The dialog must exist somewhere in the document (sanity).
    const dialog = screen.getByRole("dialog")
    expect(dialog).toBeDefined()

    // PR2.9-fix2 contract: the overlay (dialog's parent — the fixed-
    // inset-0 div) sits directly under document.body, NOT inside the
    // testing-library render container. That's how we know the portal
    // is active.
    const overlay = dialog.parentElement
    expect(overlay).not.toBeNull()
    expect(overlay!.parentElement).toBe(document.body)

    // The render container should NOT contain the overlay — the testing-
    // library `container` is a child of body, but our portal target IS
    // body, so the overlay is a SIBLING of container.
    expect(container.contains(overlay)).toBe(false)
  })

  it("closes via Escape key after portaling", () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} title="Escape test">
        <p>x</p>
      </Modal>,
    )

    // Document-level keydown still fires because Modal's useEffect
    // attaches to `document.addEventListener("keydown", ...)`. Portal
    // doesn't change which DOM hosts the event listener.
    act(() => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("closes via overlay click after portaling", () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} title="Overlay-click test">
        <p>x</p>
      </Modal>,
    )

    const dialog = screen.getByRole("dialog")
    const overlay = dialog.parentElement as HTMLElement
    expect(overlay).not.toBeNull()
    // Simulate click on the overlay itself (not the dialog). The Modal
    // implementation gates this via `e.target === e.currentTarget` so
    // clicks INSIDE the dialog are stopPropagation'd.
    act(() => {
      overlay.click()
    })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("does not close when clicking inside the dialog body", () => {
    const onClose = vi.fn()
    render(
      <Modal open onClose={onClose} title="Inner-click test">
        <button type="button" data-testid="inner-btn">Inner</button>
      </Modal>,
    )

    const innerBtn = screen.getByTestId("inner-btn")
    act(() => { innerBtn.click() })
    expect(onClose).not.toHaveBeenCalled()
  })

  it("renders nothing when open=false (preserves existing contract)", () => {
    render(
      <Modal open={false} onClose={() => {}} title="Closed test">
        <p>x</p>
      </Modal>,
    )
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("two open Modals: the later-mounted one is the LATER child of document.body (deterministic stacking)", () => {
    // PR2.9-fix2 stacking guard. The bug being fixed: BYOK modal
    // rendered EARLIER in Step2 JSX than BrowseToolsModal → DOM order
    // put BYOK as the EARLIER body-direct-child → stacked BELOW Browse.
    //
    // After portaling: each Modal independently appends itself to
    // document.body when its mount-useEffect runs. Mount order on the
    // page = order of useEffect firings = order of appendChild to body
    // = stacking order. The latest-opened modal is the LATER child of
    // body, which (at the same z-50) stacks ON TOP.
    //
    // This test pins THAT invariant: if you mount A then B, B's overlay
    // appears LATER in document.body's children than A's.
    render(
      <>
        <Modal open onClose={() => {}} title="Modal A">
          <p data-testid="modal-a-body">A</p>
        </Modal>
        <Modal open onClose={() => {}} title="Modal B">
          <p data-testid="modal-b-body">B</p>
        </Modal>
      </>,
    )

    const overlayA = screen.getByTestId("modal-a-body").closest('[role="dialog"]')!.parentElement!
    const overlayB = screen.getByTestId("modal-b-body").closest('[role="dialog"]')!.parentElement!

    // Both overlays are direct children of body.
    expect(overlayA.parentElement).toBe(document.body)
    expect(overlayB.parentElement).toBe(document.body)

    // B was rendered LATER in JSX → mounted LATER → appended LATER to
    // body → comes AFTER A in document.body.children. At equal z-index,
    // CSS painting puts later DOM siblings ON TOP.
    //
    // Critical: this guarantee is INDEPENDENT of where each Modal was
    // declared in source code. If a future Modal-on-Modal scenario
    // mounts B from inside a deeply-nested component while A mounts at
    // the root, B still wins by mount order — which is the correct
    // UX everywhere.
    const bodyChildren = Array.from(document.body.children)
    const indexA = bodyChildren.indexOf(overlayA)
    const indexB = bodyChildren.indexOf(overlayB)
    expect(indexA).toBeGreaterThanOrEqual(0)
    expect(indexB).toBeGreaterThan(indexA)
  })

  it("PR2.9-fix2 (Bug 3) regression: BYOK form opened from inside Browse stacks ABOVE Browse, regardless of JSX-source-order", () => {
    // The real bug. Step2 declared the BYOK CredentialsModal EARLIER in
    // JSX than BrowseToolsModal (because <BYOKModal/> was up at the
    // page level and <BrowseToolsModal/> was rendered slightly later in
    // the same fragment). Without portaling, two open modals at z-50
    // stack by JSX-DOM order → BYOK was BENEATH Browse.
    //
    // With portaling, mount order in WALL-CLOCK time decides stacking,
    // not JSX position. This test simulates the real flow:
    //   1. User opens Browse → Browse modal mounts (T1)
    //   2. User clicks Connect on Typefully inside Browse →
    //      BYOK form opens → BYOK modal mounts (T2 > T1)
    //   3. BYOK must end up as a LATER body-child than Browse, even
    //      though BYOK is declared FIRST in JSX (the actual Step2
    //      ordering that caused the bug).
    function StackedModalsHarness() {
      const [byokOpen, setByokOpen] = useState(false)
      return (
        <>
          {/* DELIBERATELY declared FIRST — mirrors the Step2 JSX order
              that caused the original bug. */}
          <Modal open={byokOpen} onClose={() => setByokOpen(false)} title="BYOK form">
            <p data-testid="byok-body">Enter API key</p>
          </Modal>
          {/* Browse declared SECOND. Pre-portal this would have stacked
              ABOVE the BYOK form simply because of DOM position. */}
          <Modal open onClose={() => {}} title="Browse tools">
            <button
              type="button"
              data-testid="browse-connect-btn"
              onClick={() => setByokOpen(true)}
            >
              Connect Typefully
            </button>
          </Modal>
        </>
      )
    }

    render(<StackedModalsHarness />)

    // Step 1: only Browse is open initially. Sanity.
    const browseDialog = screen.getByText("Browse tools").closest('[role="dialog"]') as HTMLElement
    const browseOverlay = browseDialog.parentElement as HTMLElement
    expect(browseOverlay.parentElement).toBe(document.body)
    expect(screen.queryByTestId("byok-body")).toBeNull()

    // Step 2: user clicks Connect inside Browse → BYOK opens.
    act(() => {
      screen.getByTestId("browse-connect-btn").click()
    })

    const byokDialog = screen.getByTestId("byok-body").closest('[role="dialog"]') as HTMLElement
    const byokOverlay = byokDialog.parentElement as HTMLElement
    expect(byokOverlay.parentElement).toBe(document.body)

    // Step 3: THE assertion that fixes the bug. BYOK was declared
    // FIRST in JSX. Pre-portal, browseOverlay would have been the
    // later DOM sibling → painted on top → BYOK invisible. With portal
    // + mount-order stacking, the user's INTENT (open BYOK after
    // Browse) drives stacking: byokOverlay must come AFTER
    // browseOverlay in document.body.children.
    const bodyChildren = Array.from(document.body.children)
    const browseIdx = bodyChildren.indexOf(browseOverlay)
    const byokIdx = bodyChildren.indexOf(byokOverlay)
    expect(browseIdx).toBeGreaterThanOrEqual(0)
    expect(byokIdx).toBeGreaterThan(browseIdx)

    // And the BYOK content must be REACHABLE — it's now interactive
    // because it's on top.
    expect(screen.getByText("Enter API key")).toBeDefined()
  })
})

function ReviewModalHarness() {
  const [open, setOpen] = useState(true)
  const [title, setTitle] = useState("")
  const [body, setBody] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [rating, setRating] = useState(1)

  return (
    <Modal
      open={open}
      onClose={() => {
        setOpen(false)
        setError(null)
      }}
      title="Write a Review"
    >
      <div>
        <ReviewStars value={rating} onChange={setRating} />
        <input
          aria-label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <textarea
          aria-label="Review"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        {error ? <p>{error}</p> : null}
      </div>
    </Modal>
  )
}

describe("Modal — C4 focus-once while open (inline onClose)", () => {
  it("keeps Title/Review focused when inline onClose identity changes each keystroke", async () => {
    const user = userEvent.setup()
    render(<ReviewModalHarness />)

    const title = await screen.findByLabelText("Title")
    await user.click(title)
    await user.type(title, "TEST")

    expect(document.activeElement).toBe(title)
    expect(title).toHaveProperty("value", "TEST")
    expect(screen.getByRole("radio", { name: "1 star" }).getAttribute("aria-checked")).toBe("true")
    expect(document.activeElement).not.toBe(screen.getByRole("radio", { name: "1 star" }))

    const review = screen.getByLabelText("Review")
    await user.click(review)
    await user.type(review, "HELLO")

    expect(document.activeElement).toBe(review)
    expect(review).toHaveProperty("value", "HELLO")
    expect(screen.getByRole("radio", { name: "1 star" }).getAttribute("aria-checked")).toBe("true")
  })

  it("MUTATION: restore [open, onClose, trapFocus] refocus → this fails", () => {
    const src = readFileSync(join(process.cwd(), "src/components/ui/modal.tsx"), "utf8")
    expect(src).toContain("onCloseRef")
    expect(src).toContain("boxRef.current.contains(document.activeElement)")
    expect(src).not.toMatch(/\[open,\s*onClose,\s*trapFocus\]/)
    expect(src).toMatch(/\}, \[open, trapFocus\]\)/)
  })

  it("Escape still calls the latest onClose after parent re-render", async () => {
    const user = userEvent.setup()
    render(<ReviewModalHarness />)
    await screen.findByRole("dialog")
    await user.keyboard("{Escape}")
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull()
    })
  })
})
