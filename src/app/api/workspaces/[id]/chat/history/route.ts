import { NextRequest } from "next/server"
import { getSessionUser } from "@/lib/api/auth"
import { verifyWorkspaceOwnership } from "@/lib/api/ownership"
import { apiError, apiSuccess, ERRORS } from "@/lib/api/response"
import { prisma } from "@/lib/db"
import { formatActivityLog, type ActivityLogFormatInput } from "@/lib/activity-log-format"
import { DELIVERABLE_EXTRACT_EVENT_KIND } from "@/lib/artifacts/deliverable-kind"

export const dynamic = "force-dynamic"

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100
const WEBCHAT_MARKER = '"channelId":"webchat"'
const DELIVERABLE_MARKER = `"eventKind":"${DELIVERABLE_EXTRACT_EVENT_KIND}"`

interface HistoryCursor {
  timestamp: string
  id: string
}

function encodeCursor(cursor: HistoryCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url")
}

function decodeCursor(raw: string | null): HistoryCursor | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<HistoryCursor>
    if (
      typeof parsed.timestamp === "string" &&
      typeof parsed.id === "string" &&
      !Number.isNaN(Date.parse(parsed.timestamp))
    ) {
      return { timestamp: parsed.timestamp, id: parsed.id }
    }
  } catch {
    // handled by caller as a validation error
  }
  throw new Error("invalid cursor")
}

function parseLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT
  return Math.min(parsed, MAX_LIMIT)
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser()
  if (!user) return ERRORS.UNAUTHORIZED()
  const { id } = await params

  const { error } = await verifyWorkspaceOwnership(id, user.id)
  if (error === "NOT_FOUND") return ERRORS.NOT_FOUND("Workspace")
  if (error === "FORBIDDEN") return ERRORS.FORBIDDEN()

  const { searchParams } = new URL(req.url)
  const limit = parseLimit(searchParams.get("limit"))
  let cursor: HistoryCursor | null
  try {
    cursor = decodeCursor(searchParams.get("before"))
  } catch {
    return apiError("INVALID_CURSOR", "before cursor is invalid", 400)
  }

  const rows = await prisma.activityLog.findMany({
    where: {
      workspaceId: id,
      AND: [
        {
          OR: [
            {
              actionType: { in: ["MESSAGE_RECEIVED", "MESSAGE_SENT"] },
              metadata: { contains: WEBCHAT_MARKER },
            },
            {
              actionType: "SYSTEM",
              metadata: { contains: DELIVERABLE_MARKER },
            },
          ],
        },
        ...(cursor
          ? [
              {
                OR: [
                  { timestamp: { lt: new Date(cursor.timestamp) } },
                  { timestamp: new Date(cursor.timestamp), id: { lt: cursor.id } },
                ],
              },
            ]
          : []),
      ],
    },
    orderBy: [{ timestamp: "desc" }, { id: "desc" }],
    take: limit + 1,
  })

  const hasMore = rows.length > limit
  const page = rows.slice(0, limit)
  const oldest = page.at(-1)

  return apiSuccess({
    rows: page
      .slice()
      .reverse()
      .map((row) => formatActivityLog(row as ActivityLogFormatInput)),
    nextCursor: hasMore && oldest
      ? encodeCursor({ timestamp: oldest.timestamp.toISOString(), id: oldest.id })
      : null,
  })
}
