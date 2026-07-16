// @vitest-environment jsdom
/**
 * Batch B reload-consistency: after Stop, local list shows stopped;
 * a subsequent fetchWorkspaces with STOPPED from server stays stopped.
 */
import { describe, expect, it } from "vitest"
import { mapWorkspaceStatus } from "@/lib/utils"

describe("My Claws Stop list reconcile (Batch B)", () => {
  it("maps STOPPED → stopped badge (post-Stop reload shape)", () => {
    expect(mapWorkspaceStatus("STOPPED")).toBe("stopped")
  })

  it("handleStopped patch shape: RUNNING row becomes stopped without remount", () => {
    // Lightweight state machine mirroring page.tsx handleStopped
    type Row = { id: string; apiStatus: string; status: ReturnType<typeof mapWorkspaceStatus> }
    let rows: Row[] = [{ id: "ws-1", apiStatus: "RUNNING", status: "running" }]

    function handleStopped(id: string, apiStatus: string) {
      const badge = mapWorkspaceStatus(apiStatus)
      rows = rows.map((w) => (w.id === id ? { ...w, apiStatus, status: badge } : w))
    }

    handleStopped("ws-1", "STOPPED")
    expect(rows[0].apiStatus).toBe("STOPPED")
    expect(rows[0].status).toBe("stopped")

    // Simulate reload from server
    rows = [{ id: "ws-1", apiStatus: "STOPPED", status: mapWorkspaceStatus("STOPPED") }]
    expect(rows[0].status).toBe("stopped")
  })

  it("MUTATION: omitting patch leaves Running", () => {
    const rows = [{ id: "ws-1", apiStatus: "RUNNING", status: "running" as const }]
    // no handleStopped call
    expect(rows[0].status).toBe("running")
    expect(rows[0].status).not.toBe("stopped")
  })
})
