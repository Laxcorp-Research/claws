import { logger } from "@/lib/axiom/server"

export const log = {
  apiRequest: (data: {
    method: string
    path: string
    userId?: string
    status: number
    durationMs: number
    error?: string
  }) => {
    const level = data.status >= 500 ? "error" : data.status >= 400 ? "warn" : "info"
    logger[level]("API request", { category: "api", ...data })
  },

  authEvent: (data: {
    event: "login" | "logout" | "signup" | "magic_link_sent" | "failed_attempt"
    userId?: string
    provider?: string
    ip?: string
    error?: string
  }) => {
    logger.info("Auth event", { category: "auth", ...data })
  },

  paymentEvent: (data: {
    event: string
    dodoCustomerId?: string
    userId?: string
    amount?: number
    currency?: string
    templateId?: string
    status: string
    error?: string
  }) => {
    const level = data.error ? "error" : "info"
    logger[level]("Payment event", { category: "payment", ...data })
  },

  deployEvent: (data: {
    event: "started" | "completed" | "failed" | "stopped" | "restarted"
    workspaceId: string
    userId: string
    durationMs?: number
    error?: string
  }) => {
    const level = data.event === "failed" ? "error" : "info"
    logger[level]("Deploy event", { category: "deploy", ...data })
  },

  toolEvent: (data: {
    event: "connected" | "disconnected" | "swapped" | "failed"
    toolSlug: string
    connectionType: string
    workspaceId: string
    userId: string
    error?: string
  }) => {
    const level = data.event === "failed" ? "error" : "info"
    logger[level]("Tool event", { category: "tool", ...data })
  },

  marketplaceEvent: (data: {
    event: "template_published" | "skill_published" | "template_purchased" | "skill_installed" | "review_submitted" | "report_filed"
    itemId: string
    itemType: "template" | "skill"
    userId: string
    details?: Record<string, unknown>
  }) => {
    logger.info("Marketplace event", { category: "marketplace", ...data })
  },

  adminAction: (data: {
    action: string
    adminId: string
    adminEmail: string
    targetId: string
    targetType: string
    details?: Record<string, unknown>
    ip?: string
  }) => {
    logger.info("Admin action", { category: "admin_audit", ...data })
  },

  error: (message: string, data?: Record<string, unknown>) => {
    logger.error(message, { category: "error", ...data })
  },

  info: (message: string, data?: Record<string, unknown>) => {
    logger.info(message, { category: "general", ...data })
  },

  warn: (message: string, data?: Record<string, unknown>) => {
    logger.warn(message, { category: "general", ...data })
  },
}
