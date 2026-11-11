import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { syncAppOrigin } from "@/lib/openclaw/sync-channel"

/**
 * The published runtime PUTs gzip to a Vercel Blob client URL, then asks
 * finalize to download that URL. Self-host has no Blob store. The PUT writes
 * the bytes to disk (and memory) so finalize can read them even if the two
 * requests are not served by the same module instance.
 */
const staged = new Map<string, Buffer>()

function blobDir(): string {
  return process.env.CLAWS_SNAPSHOT_DIR?.trim() || join(tmpdir(), "claws-self-host-blobs")
}

function blobFile(pathname: string): string {
  const safe = pathname.replace(/[^a-zA-Z0-9._-]+/g, "_")
  return join(blobDir(), safe)
}

export function stageSelfHostBlob(pathname: string, bytes: Buffer): string {
  const url = `${syncAppOrigin()}/api/internal/state/blob-put?pathname=${encodeURIComponent(pathname)}`
  staged.set(pathname, bytes)
  staged.set(url, bytes)
  mkdirSync(blobDir(), { recursive: true })
  writeFileSync(blobFile(pathname), bytes)
  return url
}

export function readStagedSelfHostBlob(blobUrl: string): Buffer | null {
  const direct = staged.get(blobUrl)
  if (direct) return direct
  try {
    const pathname = new URL(blobUrl).searchParams.get("pathname")
    if (!pathname) return null
    const mem = staged.get(pathname)
    if (mem) return mem
    return readFileSync(blobFile(pathname))
  } catch {
    return null
  }
}
