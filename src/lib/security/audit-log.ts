import { log } from "@/lib/logger"

type AdminAction =
  | "template.approve"
  | "template.reject"
  | "skill.approve"
  | "skill.reject"
  | "skill.sandbox_rerun"
  | "report.resolve"
  | "version.promote"
  | "version.edit"
  | "version.force-update"
  | "workspace.candidate-soak"
  | "payout.release"
  | "payout.process"

interface AuditLogEntry {
  action: AdminAction
  adminId: string
  adminEmail: string
  targetId: string
  targetType: "template" | "skill" | "report" | "version" | "payout" | "workspace"
  details?: Record<string, unknown>
  ip?: string
}

export function logAdminAction(entry: AuditLogEntry) {
  log.adminAction({
    action: entry.action,
    adminId: entry.adminId,
    adminEmail: entry.adminEmail,
    targetId: entry.targetId,
    targetType: entry.targetType,
    details: entry.details,
    ip: entry.ip,
  })
}
