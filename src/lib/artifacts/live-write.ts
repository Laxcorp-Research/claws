import { prisma } from "@/lib/db"
import { log } from "@/lib/logger"
import { hashFileContent } from "@/lib/artifacts/extract-deliverables"
import {
  isSharedWritePath,
  WORKSPACE_FILE_MAX_BYTES,
} from "@/lib/artifacts/workspace-file-allowlist"
import { getGatewayConnectionInfo } from "@/lib/openclaw/deployer"
import { DEFAULT_SYNC_TIMEOUT_MS, trySyncNow } from "@/lib/openclaw/sync-now"
import type { FileVersionTrigger } from "@/generated/prisma/client"

export const WORKSPACE_FILE_WRITTEN_EVENT_KIND = "workspace_file_written"
export const DEFAULT_LIVE_WRITE_TIMEOUT_MS = 15_000

export type LiveWriteOk = {
  ok: true
  fileVersionId: string
  version: number
  unchanged: boolean
  bytes: number
}

export type LiveWriteFail = {
  ok: false
  error: string
  status: number
  diskWritten?: boolean
}

export type LiveWriteResult = LiveWriteOk | LiveWriteFail

function hostFromWsUrl(wsUrl: string): string {
  return wsUrl.replace(/^wss:\/\//, "").replace(/^https:\/\//, "")
}

function jsonError(res: Response): Promise<string | undefined> {
  return res
    .json()
    .then((body: { error?: unknown }) => (typeof body?.error === "string" ? body.error : undefined))
    .catch(() => undefined)
}

/**
 * PUT shared/** into a running container, then ledger FileVersion + ActivityLog.
 * Auth on the overlay is the workspace gateway token (Bearer), not the metering secret.
 */
export async function writeWorkspaceSharedFile(args: {
  workspaceId: string
  logicalPath: string
  content: string
  createdBy: string
  trigger?: FileVersionTrigger
  timeoutMs?: number
  fetchImpl?: typeof fetch
}): Promise<LiveWriteResult> {
  const logicalPath = args.logicalPath.replace(/\\/g, "/")
  if (!args.createdBy || typeof args.content !== "string") {
    return { ok: false, error: "missing_fields", status: 400 }
  }
  if (args.content.includes("\0") || !isSharedWritePath(logicalPath)) {
    return { ok: false, error: "path_not_allowed", status: 403 }
  }
  const bytes = Buffer.byteLength(args.content, "utf8")
  if (bytes > WORKSPACE_FILE_MAX_BYTES) {
    return { ok: false, error: "too_large", status: 413 }
  }

  const info = await getGatewayConnectionInfo(args.workspaceId)
  if (!info) {
    return { ok: false, error: "no_gateway", status: 503 }
  }
  const host = hostFromWsUrl(info.wsUrl)
  const timeoutMs = args.timeoutMs ?? DEFAULT_LIVE_WRITE_TIMEOUT_MS
  const fetchImpl = args.fetchImpl ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  let res: Response
  try {
    res = await fetchImpl(`https://${host}/internal/workspace-files`, {
      method: "PUT",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${info.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ path: logicalPath, content: args.content }),
    })
  } catch (err) {
    const isTimeout = controller.signal.aborted || (err instanceof Error && err.name === "AbortError")
    return { ok: false, error: isTimeout ? "timeout" : "unreachable", status: 502 }
  } finally {
    clearTimeout(timer)
  }

  if (res.status !== 200) {
    const error = (await jsonError(res)) ?? `http-${res.status}`
    return { ok: false, error, status: res.status === 401 ? 401 : res.status }
  }

  const contentHash = hashFileContent(args.content)
  const trigger = args.trigger ?? "EDIT"

  try {
    const latest = await prisma.fileVersion.findFirst({
      where: { workspaceId: args.workspaceId, logicalPath },
      orderBy: { version: "desc" },
      select: { id: true, version: true, contentHash: true },
    })
    if (latest && latest.contentHash === contentHash) {
      void trySyncNow(host, DEFAULT_SYNC_TIMEOUT_MS, undefined, args.workspaceId)
      return { ok: true, fileVersionId: latest.id, version: latest.version, unchanged: true, bytes }
    }

    const nextVersion = (latest?.version ?? 0) + 1
    const created = await prisma.fileVersion.create({
      data: {
        workspaceId: args.workspaceId,
        logicalPath,
        version: nextVersion,
        content: args.content,
        contentHash,
        createdBy: args.createdBy,
        trigger,
        decision: "NONE",
      },
    })

    await prisma.activityLog.create({
      data: {
        workspaceId: args.workspaceId,
        action: `Workspace file written: ${logicalPath}`,
        actionType: "SYSTEM",
        detail: logicalPath,
        metadata: JSON.stringify({
          eventKind: WORKSPACE_FILE_WRITTEN_EVENT_KIND,
          fileVersionId: created.id,
          logicalPath,
          version: nextVersion,
          contentHash,
          trigger,
          bytes,
        }),
      },
    })

    void trySyncNow(host, DEFAULT_SYNC_TIMEOUT_MS, undefined, args.workspaceId)
    return { ok: true, fileVersionId: created.id, version: nextVersion, unchanged: false, bytes }
  } catch (err) {
    log.error("live-write: disk write succeeded but FileVersion ledger failed", {
      workspaceId: args.workspaceId,
      logicalPath,
      error: err instanceof Error ? err.message : String(err),
    })
    return { ok: false, error: "ledger_failed", status: 500, diskWritten: true }
  }
}
