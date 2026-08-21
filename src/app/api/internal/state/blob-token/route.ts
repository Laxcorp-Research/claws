import { NextRequest } from "next/server"
import { generateClientTokenFromReadWriteToken } from "@vercel/blob/client"
import { log } from "@/lib/logger"
import { ABSOLUTE_MAX_COMPRESSED_BYTES } from "@/lib/openclaw/state-sync-limits"
import {
  assertMeteringSecret,
  parseStoreIdFromReadWriteToken,
} from "@/lib/openclaw/state-sync-auth"

export const maxDuration = 30

const DEFAULT_BLOB_API_URL = "https://vercel.com/api/blob"

/**
 * Issues a short-lived Vercel Blob client token so the container can PUT the
 * gzipped snapshot directly to Blob (bypassing the Vercel edge body cap).
 *
 * Auth: X-Metering-Secret (same as /state/upload).
 */
export async function POST(req: NextRequest) {
  if (!assertMeteringSecret(req)) {
    return new Response("Unauthorized", { status: 401 })
  }

  const rwToken = process.env.BLOB_READ_WRITE_TOKEN
  if (!rwToken) {
    log.error("BLOB_READ_WRITE_TOKEN unset - cannot issue state blob token")
    return Response.json({ success: false, error: "Blob not configured" }, { status: 503 })
  }

  let body: { workspaceId?: unknown; sha256?: unknown; compressedSize?: unknown }
  try {
    body = await req.json()
  } catch {
    return Response.json({ success: false, error: "Invalid JSON" }, { status: 400 })
  }

  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId.trim() : ""
  const sha256 = typeof body.sha256 === "string" ? body.sha256.trim().toLowerCase() : ""
  const compressedSize =
    typeof body.compressedSize === "number" && Number.isFinite(body.compressedSize)
      ? body.compressedSize
      : null

  if (!workspaceId || !/^[a-z0-9_-]+$/i.test(workspaceId)) {
    return Response.json({ success: false, error: "Invalid workspaceId" }, { status: 400 })
  }
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    return Response.json({ success: false, error: "Invalid sha256" }, { status: 400 })
  }
  if (compressedSize === null || compressedSize <= 0 || compressedSize > ABSOLUTE_MAX_COMPRESSED_BYTES) {
    return Response.json({ success: false, error: "Invalid compressedSize" }, { status: 400 })
  }

  const pathname = `runtime-state/${workspaceId}/${Date.now()}-${sha256.slice(0, 16)}.gz`
  const storeId = parseStoreIdFromReadWriteToken(rwToken)
  if (!storeId) {
    log.error("Could not parse storeId from BLOB_READ_WRITE_TOKEN")
    return Response.json({ success: false, error: "Blob token malformed" }, { status: 503 })
  }

  try {
    const clientToken = await generateClientTokenFromReadWriteToken({
      pathname,
      token: rwToken,
      maximumSizeInBytes: ABSOLUTE_MAX_COMPRESSED_BYTES,
      allowedContentTypes: ["application/gzip", "application/octet-stream"],
      addRandomSuffix: false,
      allowOverwrite: true,
      validUntil: Date.now() + 15 * 60 * 1000,
    })

    return Response.json({
      success: true,
      pathname,
      clientToken,
      storeId,
      apiUrl: process.env.VERCEL_BLOB_API_URL || DEFAULT_BLOB_API_URL,
      maximumSizeInBytes: ABSOLUTE_MAX_COMPRESSED_BYTES,
    })
  } catch (err) {
    log.error("Failed to generate Blob client token", {
      workspaceId,
      error: err instanceof Error ? err.message : String(err),
    })
    return Response.json({ success: false, error: "Token generation failed" }, { status: 500 })
  }
}
