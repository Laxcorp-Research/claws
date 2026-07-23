/** Client-safe marketing floor for tool-integration counts. */
export const TOOL_COUNT_MARKETING_FLOOR = 1100

/**
 * Floor to hundreds with locale thousands separator + suffix.
 * Never below marketing floor. Example: 1234 → "1,200+".
 */
export function formatToolCountFloorLabel(count: number): string {
  const floored = Math.floor(count / 100) * 100
  const effective = Math.max(floored, TOOL_COUNT_MARKETING_FLOOR)
  return `${effective.toLocaleString("en-US")}+`
}
