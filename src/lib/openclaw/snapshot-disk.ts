import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"

export function snapshotDirectory(raw = process.env.CLAWS_SNAPSHOT_DIR): string | null {
  const dir = raw?.trim()
  return dir && dir.length > 0 ? dir : null
}

export function snapshotFilePath(workspaceId: string, dir = snapshotDirectory()): string {
  if (!dir) throw new Error("CLAWS_SNAPSHOT_DIR is not set")
  if (!/^[\w-]+$/.test(workspaceId)) {
    throw new Error("workspaceId is not a safe snapshot filename")
  }
  return join(dir, `${workspaceId}.bin`)
}

export async function writeRuntimeSnapshotToDisk(
  workspaceId: string,
  bytes: Buffer,
): Promise<string> {
  const dir = snapshotDirectory()
  if (!dir) throw new Error("CLAWS_SNAPSHOT_DIR is not set")
  await mkdir(dir, { recursive: true })
  const path = snapshotFilePath(workspaceId, dir)
  await writeFile(path, bytes)
  return path
}

export async function readRuntimeSnapshotFromDisk(workspaceId: string): Promise<Buffer> {
  return readFile(snapshotFilePath(workspaceId))
}
