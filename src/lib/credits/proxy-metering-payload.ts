/**
 * Byte-exact contract for what container/credit-proxy.mjs POSTs to
 * /api/internal/metering/report-batch (and the per-record shape of
 * UsageReporter.add). Keep in lockstep with credit-proxy.mjs — the image
 * is baked (-8); the platform route must accept THIS shape.
 *
 * Report POST (credit-proxy.mjs flush):
 *   URL:     `${CLAWS_METERING_ENDPOINT}/report-batch`
 *   Header:  X-Metering-Secret: <CLAWS_METERING_SECRET>
 *   Body:    { records: UsageRecord[], droppedCount: number }
 *
 * Record (reporter.add):
 *   { workspaceId, agentId, provider, model, inputTokens, outputTokens,
 *     costCents, timestamp }
 */
import { z } from "zod"

export const METERING_SECRET_HEADER = "X-Metering-Secret"

/** Mirrors credit-proxy.mjs UsageReporter.add(...) */
export const proxyUsageRecordSchema = z.object({
  workspaceId: z.string().min(1),
  agentId: z.string().nullable().optional(),
  provider: z.literal("ANTHROPIC"),
  model: z.string().min(1),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costCents: z.number().int().nonnegative(),
  timestamp: z.string().min(1),
})

export const proxyReportBatchBodySchema = z.object({
  records: z.array(proxyUsageRecordSchema).min(1),
  droppedCount: z.number().int().nonnegative().optional().default(0),
})

export type ProxyUsageRecord = z.infer<typeof proxyUsageRecordSchema>
export type ProxyReportBatchBody = z.infer<typeof proxyReportBatchBodySchema>

/** Construct the same record object credit-proxy.mjs pushes onto pending. */
export function buildProxyUsageRecord(input: {
  workspaceId: string
  agentId?: string | null
  model: string
  inputTokens: number
  outputTokens: number
  costCents: number
  timestamp?: string
}): ProxyUsageRecord {
  return {
    workspaceId: input.workspaceId,
    agentId: input.agentId ?? null,
    provider: "ANTHROPIC",
    model: input.model,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    costCents: input.costCents,
    timestamp: input.timestamp ?? new Date().toISOString(),
  }
}

/** Construct the same JSON body credit-proxy.mjs JSON.stringify's in flush(). */
export function buildProxyReportBatchBody(
  records: ProxyUsageRecord[],
  droppedCount = 0,
): ProxyReportBatchBody {
  return { records, droppedCount }
}

/** Reserve-window body from credit-proxy.mjs CreditWindow.canSpend. */
export const proxyReserveWindowBodySchema = z.object({
  userId: z.string().min(1),
  windowSizeCents: z.number().int().positive(),
})
