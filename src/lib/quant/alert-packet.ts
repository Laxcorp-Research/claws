/**
 * Quant PASS thesis must land a trade-alert file before the mission is done.
 *
 * MUTATION: treat a PASS thesis with no trade-alert-*.md as a completed
 * mission → alert-packet.test.ts fails.
 */

import { parseClaimsTable } from "@/lib/critic/claims-table"

export const ALERT_ONLY_NO_ORDER = "ALERT-ONLY: no order placed"

/** Seed stub is trade-alert.md. Runtime writes trade-alert-YYYY-MM-DD.md. */
export const TRADE_ALERT_PATH_RE = /(?:^|\/)trade-alert(?:-\d{4}-\d{2}-\d{2})?\.md$/

export function isTradeAlertLogicalPath(path: string): boolean {
  return TRADE_ALERT_PATH_RE.test(path.replace(/\\/g, "/"))
}

export function thesisLooksPass(thesisText: string): boolean {
  return /\bverdict:\s*PASS\b/i.test(thesisText)
}

export function tradeAlertFileIsComplete(content: string): boolean {
  if (!content.includes(ALERT_ONLY_NO_ORDER)) return false
  if (parseClaimsTable(content) === null) return false
  if (!/\bthesis\b/i.test(content)) return false
  if (!/\bsize\b/i.test(content)) return false
  return true
}

/**
 * Returns false when a PASS thesis is missing a complete alert file.
 * That is a mission fail.
 */
export function quantPassThesisRequiresAlertFile(args: {
  thesisText: string
  files: Array<{ path: string; content: string }>
}): boolean {
  if (!thesisLooksPass(args.thesisText)) return true
  const alert = args.files.find((file) => isTradeAlertLogicalPath(file.path))
  if (!alert) return false
  return tradeAlertFileIsComplete(alert.content)
}
