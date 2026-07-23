import { ALL_TOOLS } from "@/data/tool-catalog"
import { getComposioCatalogTools } from "@/lib/composio-catalog"

export const TOOL_COUNT_MARKETING_FLOOR = 1100

/** Floor to hundreds with + suffix. Never below marketing floor. */
export function formatToolCountFloorLabel(count: number): string {
  const floored = Math.floor(count / 100) * 100
  const effective = Math.max(floored, TOOL_COUNT_MARKETING_FLOOR)
  return `${effective}+`
}

export async function getToolIntegrationCount(): Promise<number> {
  const composioTools = await getComposioCatalogTools()
  return ALL_TOOLS.length + composioTools.length
}
