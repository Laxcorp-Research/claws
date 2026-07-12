import { NextRequest } from "next/server"
import { log } from "@/lib/logger"
import { assertMeteringSecret } from "@/lib/openclaw/state-sync-auth"

export const maxDuration = 30

/**
 * Inline state upload is retired (D2 Blob-only transport).
 * Old-image containers that still POST here get a loud 413 USE_BLOB so
 * operators see the failure instead of a silent edge drop.
 */
export async function POST(req: NextRequest) {
  if (!assertMeteringSecret(req)) {
    return new Response("Unauthorized", { status: 401 })
  }

  // Consume body so clients don't hang; ignore contents.
  try {
    await req.json()
  } catch {
    // empty / non-JSON still rejected the same way
  }

  log.warn("Inline state /upload rejected — Blob transport required", {
    code: "USE_BLOB",
  })

  return Response.json(
    {
      success: false,
      code: "USE_BLOB",
      error: "USE_BLOB",
      message: "Inline state upload removed; use Blob token + finalize",
    },
    { status: 413 },
  )
}
