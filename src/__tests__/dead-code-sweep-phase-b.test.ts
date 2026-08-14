import { existsSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = resolve(__dirname, "../..")

const REMOVED_SURFACES = [
  "src/app/api/deploy/[workspaceId]/health/route.ts",
  "src/app/api/deploy/[workspaceId]/logs/route.ts",
  "src/app/api/api-keys/test/route.ts",
  "src/app/api/activity/[workspaceId]/pending/route.ts",
  "src/app/api/agents/[workspaceId]/[id]/position/route.ts",
  "src/app/api/agents/[workspaceId]/bulk-position/route.ts",
  "src/app/api/skills/route.ts",
  "src/app/api/skills/[slug]/route.ts",
  "src/app/api/templates/route.ts",
  "src/app/api/templates/[slug]/route.ts",
  "src/app/api/admin/containers/health/route.ts",
  "src/app/api/models/refresh/route.ts",
  "src/app/api/internal/metering/balance/route.ts",
  "src/app/api/internal/hibernation/report/route.ts",
  "src/app/api/internal/hibernation/candidates/route.ts",
  "src/components/pricing/plan-card.tsx",
  "src/components/builder/skill-preview-panel.tsx",
  "src/components/setup/tool-swap-modal.tsx",
  "src/components/store/agent-hierarchy.tsx",
  "src/components/onboarding/onboarding-session-sync.tsx",
  "src/components/dashboard/claw-narrative-row.tsx",
  ".github/workflows/ops-phasec-wire-full-redeploy.yml",
  "scripts/ops/phasec-wire-full-redeploy.mjs",
  "scripts/ops/openrouter-live-proof.mjs",
  "scripts/ops/openrouter-live-proof-finish.mjs",
  "scripts/spike-pr9-gateway-probe.mjs",
] as const

const ARCHIVED_ONE_SHOTS = [
  "backfill-next-heartbeat-at.ts",
  "backfill-superseded-deployments.ts",
  "reprovision-wire-test.ts",
  "verify-marketplace-fts.ts",
  "pr2.8a-probe.mjs",
  "pr2.8a-seed-slug-audit.mjs",
  "pr2.8a-wizard-parity-trace.mjs",
] as const

describe("dead-code sweep phase B contract", () => {
  it.each(REMOVED_SURFACES)("keeps removed surface absent: %s", (path) => {
    expect(existsSync(join(ROOT, path))).toBe(false)
  })

  it.each(ARCHIVED_ONE_SHOTS)("keeps one-shot archived: %s", (name) => {
    expect(existsSync(join(ROOT, "scripts/archive", name))).toBe(true)
    expect(existsSync(join(ROOT, "scripts", name))).toBe(false)
  })

  it("keeps health/deep and skills/from-marketplace routes", () => {
    expect(existsSync(join(ROOT, "src/app/api/health/deep/route.ts"))).toBe(true)
    expect(existsSync(join(ROOT, "src/app/api/skills/from-marketplace/route.ts"))).toBe(true)
  })

  it("keeps ENABLE_CLOUD_DEPLOY out of the example environment", () => {
    const exampleEnv = readFileSync(join(ROOT, ".env.example"), "utf8")
    expect(exampleEnv).not.toContain("ENABLE_CLOUD_DEPLOY")
  })
})
