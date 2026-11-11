import { FIXTURE_MODEL_REPLY, FIXTURE_MODEL_USAGE } from "@/lib/openclaw/gateway-origin"
import { isSelfHost } from "@/lib/profile"

export const dynamic = "force-dynamic"

function messageBody(model: string) {
  return {
    id: "msg_fixture",
    type: "message",
    role: "assistant",
    model,
    content: [{ type: "text", text: FIXTURE_MODEL_REPLY }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: FIXTURE_MODEL_USAGE.input,
      output_tokens: FIXTURE_MODEL_USAGE.output,
    },
  }
}

function sse(model: string): string {
  const started = {
    ...messageBody(model),
    content: [],
    stop_reason: null,
    usage: { input_tokens: FIXTURE_MODEL_USAGE.input, output_tokens: 0 },
  }
  const events = [
    { type: "message_start", message: started },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    {
      type: "content_block_delta",
      index: 0,
      delta: { type: "text_delta", text: FIXTURE_MODEL_REPLY },
    },
    { type: "content_block_stop", index: 0 },
    {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { output_tokens: FIXTURE_MODEL_USAGE.output },
    },
    { type: "message_stop" },
  ]
  return events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("")
}

/**
 * Anthropic Messages stand-in for a self-host key that starts with fixture-.
 * The real runtime calls this; the chat smoke reads the reply and the usage.
 */
export async function POST(req: Request): Promise<Response> {
  if (!isSelfHost()) return new Response("Not found", { status: 404 })
  let model = "claude-haiku-4-5-20251001"
  // 9.4's messages client always parses the body as SSE. A missing stream
  // flag still has to be an event stream. Explicit stream:false stays JSON.
  let stream = true
  try {
    const body = (await req.json()) as { model?: unknown; stream?: unknown }
    if (typeof body.model === "string" && body.model.length > 0) model = body.model
    stream = body.stream !== false
  } catch {
    stream = true
  }
  if (stream) {
    return new Response(sse(model), {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    })
  }
  return Response.json(messageBody(model))
}
