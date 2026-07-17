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
      handlers: ["handleRemove", "handleAdd", "handleTest", "handleSwitchSource"],
    },
    {
      file: "src/components/settings/account-settings.tsx",
      // Batch F: delete signs out only after res.ok via helper.
      handlers: ["handleDelete", "handleSave"],
    },
    {
      file: "src/components/settings/creator-dashboard.tsx",
      // Batch F: profile save must not silently catch.
      handlers: ["handleSaveProfile"],
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
        "handleBrowseConnect",
      ],
    },
    {
      file: "src/app/store/skills/[slug]/page.tsx",
      handlers: ["handleInstall"],
    },
    {
      file: "src/app/admin/reviews/page.tsx",
      handlers: ["handleApprove", "handleReject"],
    },
    {
      file: "src/app/admin/reports/page.tsx",
      handlers: ["handleResolve"],
    },
    {
      file: "src/app/admin/versions/page.tsx",
      handlers: ["handlePromote"],
    },
    {
      file: "src/components/builder/properties-panel.tsx",
      // Local store delete — snackbar wraps the call (message lock).
      handlers: ["Agent removed"],
    },
    {
      file: "src/components/builder/version-history-panel.tsx",
      // Batch D: restore failure must surface via mutateWithFeedback.
      handlers: ["Version restored", "Could not restore version"],
    },
    {
      file: "src/components/my-claws/workspace-context-menu.tsx",
      handlers: ["handleStop"],
    },
    {
      file: "src/app/my-claws/page.tsx",
      handlers: ["handleDelete", "handleRename", "handleCreateCustomClaw", "handleDuplicate"],
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
