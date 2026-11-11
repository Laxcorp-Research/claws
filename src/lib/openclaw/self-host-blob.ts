import { syncAppOrigin } from "@/lib/openclaw/sync-channel"

/**
 * The published runtime PUTs gzip to a Vercel Blob client URL, then asks
 * finalize to download that URL. Self-host has no Blob store. This map is
 * the stand-in: blob-token points apiUrl at our app, the PUT stages the
 * bytes, and finalize reads them back in the same Node process.
 */
const staged = new Map<string, Buffer>()

export function stageSelfHostBlob(pathname: string, bytes: Buffer): string {
  const url = `${syncAppOrigin()}/api/internal/state/blob-put?pathname=${encodeURIComponent(pathname)}`
  staged.set(pathname, bytes)
  staged.set(url, bytes)
  return url
}

export function readStagedSelfHostBlob(blobUrl: string): Buffer | null {
  const direct = staged.get(blobUrl)
  if (direct) return direct
  try {
    const pathname = new URL(blobUrl).searchParams.get("pathname")
    if (!pathname) return null
    return staged.get(pathname) ?? null
  } catch {
    return null
  }
}
