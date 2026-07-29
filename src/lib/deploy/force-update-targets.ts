/**
 * Force-update selection + security-patch email list hygiene.
 *
 * Current deployment = latest COMPLETED|SUPERSEDED row per workspace by
 * startedAt (hibernate may leave only SUPERSEDED; running claws keep COMPLETED).
 * Historical zombies share the same status and must not multiply fanout.
 */

export type ForceUpdateDeploymentRow = {
  id: string
  workspaceId: string
  startedAt: Date
  containerImage: string
  workspace: {
    id: string
    name: string | null
    userId: string
    user: { email: string | null; name: string | null } | null
  } | null
}

/** Keep the newest row per workspaceId (rows must already be startedAt DESC). */
export function selectCurrentDeploymentsPerWorkspace<T extends { workspaceId: string }>(
  rowsNewestFirst: T[],
): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const row of rowsNewestFirst) {
    if (seen.has(row.workspaceId)) continue
    seen.add(row.workspaceId)
    out.push(row)
  }
  return out
}

/** MUTATION: restore include-all (no distinct) → duplicate names / inflated count. */
export const FORCE_UPDATE_CURRENT_STATUSES = ["COMPLETED", "SUPERSEDED"] as const

export function uniqueSortedWorkspaceNames(names: string[]): string[] {
  return [...new Set(names)].sort((a, b) => a.localeCompare(b, "en"))
}

export function formatScheduledClawsEmailList(
  workspaceNames: string[],
  cap = 20,
): { countLine: string; listItems: string[]; overflow: number } {
  const unique = uniqueSortedWorkspaceNames(workspaceNames)
  const listItems = unique.slice(0, cap)
  const overflow = Math.max(0, unique.length - listItems.length)
  const n = unique.length
  const countLine = `${n} Claw${n === 1 ? "" : "s"} scheduled`
  return { countLine, listItems, overflow }
}

export function buildSecurityPatchEmailHtml(args: {
  userName: string | null
  version: string
  workspaceNames: string[]
  releaseNotes: string | null
}): string {
  const { countLine, listItems, overflow } = formatScheduledClawsEmailList(args.workspaceNames)
  const moreLine =
    overflow > 0 ? `<li><em>and ${overflow} more</em></li>` : ""
  const uniqueCount = uniqueSortedWorkspaceNames(args.workspaceNames).length
  const plural = uniqueCount === 1 ? "" : "s"
  const have = uniqueCount === 1 ? " has" : " have"

  return `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto;">
              <h2 style="font-size: 18px; font-weight: 600;">Security Update Scheduled</h2>
              <p style="font-size: 14px; color: #555; line-height: 1.6;">
                Hi ${args.userName || "there"},
              </p>
              <p style="font-size: 14px; color: #555; line-height: 1.6;">
                A security patch (OpenClaw v${args.version}) has been scheduled for your Claw${plural}.
              </p>
              <div style="background: #fef9c3; border: 1px solid #fde047; border-radius: 8px; padding: 14px; margin: 16px 0;">
                <p style="font-size: 13px; font-weight: 600; color: #854d0e; margin: 0;">
                  Your Claw${plural}${have} NOT been updated yet &mdash; the patch applies on the next redeploy. To apply it now, redeploy your Claw${plural} from the dashboard.
                </p>
              </div>
              <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 14px; margin: 16px 0;">
                <p style="font-size: 13px; font-weight: 600; margin: 0 0 6px 0;">${countLine}:</p>
                <ul style="font-size: 13px; color: #166534; margin: 0; padding-left: 18px;">
                  ${listItems.map((n) => `<li>${n}</li>`).join("")}
                  ${moreLine}
                </ul>
              </div>
              ${
                args.releaseNotes
                  ? `
              <p style="font-size: 13px; color: #777;">
                <strong>What changed:</strong> ${args.releaseNotes}
              </p>
              `
                  : ""
              }
              <p style="font-size: 13px; color: #999; margin-top: 24px;">
                &mdash; The Claws Team
              </p>
            </div>
          `
}
