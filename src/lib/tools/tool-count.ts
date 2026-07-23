import { ALL_TOOLS } from "@/data/tool-catalog"
import { getComposioCatalogTools } from "@/lib/composio-catalog"

export {
  TOOL_COUNT_MARKETING_FLOOR,
  formatToolCountFloorLabel,
} from "@/lib/tools/tool-count-label"

export async function getToolIntegrationCount(): Promise<number> {
  const composioTools = await getComposioCatalogTools()
  return ALL_TOOLS.length + composioTools.length
}
