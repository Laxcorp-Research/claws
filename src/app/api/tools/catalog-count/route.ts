import { apiSuccess } from "@/lib/api/response"
import {
  formatToolCountFloorLabel,
  getToolIntegrationCount,
} from "@/lib/tools/tool-count"

export async function GET() {
  const count = await getToolIntegrationCount()
  return apiSuccess({ count, label: formatToolCountFloorLabel(count) })
}
