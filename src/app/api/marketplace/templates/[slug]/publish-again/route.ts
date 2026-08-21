import { NextRequest } from "next/server"
import { ERRORS } from "@/lib/api/response"
import { getSessionUser } from "@/lib/api/auth"
import { publishAgainTemplate } from "@/lib/marketplace/creator-listing-actions"
import { listingActionResponse } from "@/lib/marketplace/listing-action-response"

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { slug } = await params
  return listingActionResponse(await publishAgainTemplate(user.id, slug))
}
