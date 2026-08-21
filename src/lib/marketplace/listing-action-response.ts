import { NextResponse } from "next/server"
import { apiSuccess, apiError } from "@/lib/api/response"
import type { ListingActionResult } from "@/lib/marketplace/creator-listing-actions"

export function listingActionResponse<T>(result: ListingActionResult<T>): NextResponse {
  if (result.ok) return apiSuccess(result.data)
  return apiError(result.code, result.message, result.status)
}
