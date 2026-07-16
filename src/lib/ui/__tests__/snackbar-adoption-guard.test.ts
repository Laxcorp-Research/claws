/**
 * PR-4 helper-import guard: every swept plain-mutation site must route
 * through mutateWithFeedback. MUTATION: bypass helper at one site → fail.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = process.cwd()

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8")
}

describe("PR-4 Snackbar adoption guard", () => {
  const sites: Array<{ file: string; handlers: string[] }> = [
    {
      file: "src/app/dashboard/[workspaceId]/page.tsx",
      handlers: [
        "handleWakeNow",
        "handleStopConfirmed",
        "handleResumeAll",
        "handleRedeployFromStopped",
        "handleApprove",
        "handleReject",
        "handleAgentControl",
      ],
    },
    {
      file: "src/components/settings/api-key-manager.tsx",
      handlers: ["handleRemove"],
    },
    {
      file: "src/app/setup/[workspaceId]/step/[n]/page.tsx",
      handlers: [
        "handleCustomDelete",
        "handleDemote",
        "handleDismiss",
        "handleRestore",
        "handleRemoveConfirm",
        "handleSwapSelect",
      ],
    },
    {
      file: "src/app/admin/reviews/page.tsx",
      handlers: ["handleApprove"],
    },
    {
      file: "src/components/builder/properties-panel.tsx",
      // Local store delete — snackbar wraps the call (message lock).
      handlers: ["Agent removed"],
    },
    {
      file: "src/components/my-claws/workspace-context-menu.tsx",
      handlers: ["handleStop"],
    },
    {
      file: "src/app/my-claws/page.tsx",
      handlers: ["handleDelete", "handleRename"],
    },
  ]

  it("every swept surface imports mutateWithFeedback", () => {
    for (const site of sites) {
      const src = read(site.file)
      expect(src, site.file).toContain('from "@/lib/ui/mutate-with-feedback"')
      expect(src, site.file).toContain("mutateWithFeedback")
    }
  })

  it("MUTATION: each swept handler body calls mutateWithFeedback", () => {
    for (const site of sites) {
      const src = read(site.file)
      for (const handler of site.handlers) {
        const idx = src.indexOf(handler)
        expect(idx, `${site.file} missing ${handler}`).toBeGreaterThanOrEqual(0)
        // Window centered on the marker so message strings after the helper still pass.
        const start = Math.max(0, idx - 400)
        const window = src.slice(start, idx + 800)
        expect(
          window,
          `${site.file} · ${handler} bypasses mutateWithFeedback`,
        ).toContain("mutateWithFeedback")
      }
    }
  })
})
