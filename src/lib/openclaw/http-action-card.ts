import {
  normalizeHttpHost,
  normalizeHttpPath,
  type HttpMethod,
} from "@/lib/openclaw/http-contract"

export const HTTP_ACTION_EVENT_KIND = "http_action"

export interface HttpActionCardView {
  skill: string
  method: string
  host: string
  path: string
  bodyPlain: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function unwrapActionBody(body: unknown): unknown {
  if (isRecord(body) && isRecord(body.arguments)) return body.arguments
  return body
}

export function renderHttpActionBodyPlain(args: {
  skill: string
  body: unknown
}): string {
  const skill = args.skill.trim()
  const body = unwrapActionBody(args.body)

  if (skill === "alpaca-trading" && isRecord(body)) {
    const side = String(body.side ?? "").toUpperCase()
    const qty = body.qty ?? body.notional
    const symbol = String(body.symbol ?? "").toUpperCase()
    if (!side || qty == null || String(qty).trim().length === 0 || !symbol) return ""
    const limit = body.limit_price ?? body.limitPrice
    const stopLoss = isRecord(body.stop_loss) ? body.stop_loss : null
    const stop = body.stop_price ?? body.stopPrice ?? stopLoss?.stop_price ?? stopLoss?.stopPrice
    const at = limit != null && String(limit).length > 0 ? ` @ $${formatHttpMoney(limit)}` : ""
    const stopBit =
      stop != null && String(stop).length > 0 && String(stop) !== String(limit)
        ? ` stop $${formatHttpMoney(stop)}`
        : ""
    return `${side} ${qty} ${symbol}${at}${stopBit}`.replace(/\s+/g, " ").trim()
  }

  if ((skill === "twitter-api" || skill === "twitter-oauth") && isRecord(body)) {
    if (typeof body.text === "string" && body.text.trim().length > 0) return body.text.trim()
  }

  if ((skill === "gmail-ops" || skill === "salesforce-crm") && isRecord(body)) {
    const to = body.to ?? body.recipient ?? body.recipient_email ?? body.email
    const subject = body.subject
    const text = body.body ?? body.text ?? body.html ?? body.message
    const lines = [
      to != null ? `to ${Array.isArray(to) ? to.join(", ") : String(to)}` : null,
      subject != null ? `subject ${String(subject)}` : null,
      text != null ? String(text) : null,
    ].filter((line): line is string => Boolean(line && line.trim()))
    if (lines.length > 0) return lines.join("\n")
  }

  if ((skill === "slack-messaging" || skill === "linkedin-api" || skill === "twitter-oauth") && isRecord(body)) {
    const text = body.text ?? body.message ?? body.body
    if (typeof text === "string" && text.trim().length > 0) {
      const channel = body.channel ?? body.channel_id
      return channel != null ? `${String(channel)}: ${text.trim()}` : text.trim()
    }
  }

  if (skill === "instantly-email" && isRecord(body)) {
    const to = body.email ?? body.to
    const subject = body.subject ?? body.campaign_name ?? body.name
    const text = body.body ?? body.message
    const lines = [
      to != null ? `to ${String(to)}` : null,
      subject != null ? `subject ${String(subject)}` : null,
      text != null ? String(text) : null,
    ].filter((line): line is string => Boolean(line && line.trim()))
    if (lines.length > 0) return lines.join("\n")
  }

  if ((skill === "binance-trading" || skill === "coinbase-trading" || skill === "polymarket-trading") && isRecord(body)) {
    const side = String(body.side ?? "").toUpperCase()
    const symbol = String(body.symbol ?? body.product_id ?? body.market ?? "").toUpperCase()
    const qty = body.qty ?? body.quantity ?? body.base_size ?? body.size
    if (side && symbol && qty != null && String(qty).trim().length > 0) {
      const price = body.price ?? body.limit_price
      const at = price != null ? ` @ $${formatHttpMoney(price)}` : ""
      return `${side} ${qty} ${symbol}${at}`.replace(/\s+/g, " ").trim()
    }
  }

  if (typeof body === "string") return body.trim()
  if (body == null) return ""
  if (Array.isArray(body) && body.length === 0) return ""
  if (isRecord(body) && Object.keys(body).length === 0) return ""
  try {
    return JSON.stringify(body, null, 2)
  } catch {
    return ""
  }
}

function formatHttpMoney(value: unknown): string {
  const n = Number(value)
  if (Number.isFinite(n)) {
    return n.toLocaleString("en-US")
  }
  return String(value)
}

export function buildHttpActionCard(args: {
  skill: string
  method: string
  host: string
  path: string
  body: unknown
}): HttpActionCardView {
  return {
    skill: args.skill.trim(),
    method: args.method.trim().toUpperCase(),
    host: normalizeHttpHost(args.host),
    path: normalizeHttpPath(args.path),
    bodyPlain: renderHttpActionBodyPlain({ skill: args.skill, body: args.body }),
  }
}

export function httpActionCardViolations(card: Partial<HttpActionCardView> | null | undefined): string[] {
  if (!card) return ["missing card"]
  const hits: string[] = []
  if (typeof card.skill !== "string" || card.skill.trim().length === 0) hits.push("missing skill")
  if (typeof card.method !== "string" || card.method.trim().length === 0) hits.push("missing method")
  if (typeof card.host !== "string" || card.host.trim().length === 0) hits.push("missing host")
  if (typeof card.path !== "string" || card.path.trim().length === 0) hits.push("missing path")
  if (typeof card.bodyPlain !== "string" || card.bodyPlain.trim().length === 0) {
    hits.push("missing body")
  }
  return hits
}

export function isHttpActionCardRenderable(card: Partial<HttpActionCardView> | null | undefined): boolean {
  return httpActionCardViolations(card).length === 0
}

export function parseHttpActionCardFromMetadata(metadata: string | null | undefined): HttpActionCardView | null {
  if (!metadata) return null
  try {
    const raw = JSON.parse(metadata) as unknown
    if (!isRecord(raw)) return null
    if (raw.eventKind !== HTTP_ACTION_EVENT_KIND) return null
    const card = isRecord(raw.card) ? raw.card : raw
    const view: HttpActionCardView = {
      skill: typeof card.skill === "string" ? card.skill : "",
      method: typeof card.method === "string" ? card.method : "",
      host: typeof card.host === "string" ? card.host : "",
      path: typeof card.path === "string" ? card.path : "",
      bodyPlain: typeof card.bodyPlain === "string" ? card.bodyPlain : "",
    }
    return isHttpActionCardRenderable(view) ? view : null
  } catch {
    return null
  }
}

export function httpActionRequestMetadata(args: {
  card: HttpActionCardView
  bodyHash: string
  method: HttpMethod | string
}): Record<string, unknown> {
  return {
    eventKind: HTTP_ACTION_EVENT_KIND,
    skill: args.card.skill,
    method: args.card.method,
    host: args.card.host,
    path: args.card.path,
    bodyHash: args.bodyHash,
    card: args.card,
  }
}
