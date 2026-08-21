import { NextRequest, NextResponse } from "next/server"
import { handleTelegramWakeOnChannel } from "@/lib/hibernation/wake-on-channel"

export const maxDuration = 300

/**
 * Telegram Bot API webhook - platform wake-on-channel ingress (P5).
 * Armed while HIBERNATED; cleared when the claw is RUNNING again.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const { workspaceId } = await params
  let update: unknown
  try {
    update = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 })
  }

  const secretHeader = req.headers.get("x-telegram-bot-api-secret-token")
  const result = await handleTelegramWakeOnChannel({
    workspaceId,
    update,
    secretHeader,
  })

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status })
  }
  // Telegram retries on non-2xx - always 200 once authenticated + parsed.
  return NextResponse.json({ ok: true, handled: result.handled })
}
