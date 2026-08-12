import { NextRequest } from "next/server"
import { apiSuccess } from "@/lib/api/response"
import { getSessionUser } from "@/lib/api/auth"
import { ERRORS } from "@/lib/api/response"
import { queryModelCatalog, catalogToLegacyOptions } from "@/lib/models/catalog"

/** Authenticated model catalog for builder / setup pickers. */
export async function GET(request: NextRequest) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()

  const sp = request.nextUrl.searchParams
  const q = sp.get("q") ?? undefined
  const provider = sp.get("provider") ?? undefined
  const pinnedOnly = sp.get("pinned") === "1" || sp.get("pinned") === "true"
  const creditMode = sp.get("creditMode") === "1" || sp.get("creditMode") === "true"
  const limit = Number(sp.get("limit") ?? (pinnedOnly ? 30 : 40))

  const models = await queryModelCatalog({
    q,
    provider: provider || undefined,
    pinnedOnly,
    creditMode,
    limit: Number.isFinite(limit) ? limit : 40,
  })

  return apiSuccess({
    models,
    options: catalogToLegacyOptions(models),
    honesty:
      "BYOK cost figures are estimates. OpenRouter and other BYOK providers are billed by your provider — Claws does not meter them.",
  })
}
