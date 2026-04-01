import { NextResponse } from "next/server"

function meta() {
  return {
    timestamp: new Date().toISOString(),
    requestId: `req_${Math.random().toString(36).slice(2, 14)}`,
  }
}

export function apiSuccess<T>(data: T, status = 200) {
  return NextResponse.json({ success: true, data, meta: meta() }, { status })
}

export function apiError(code: string, message: string, statusCode = 400) {
  return NextResponse.json(
    { success: false, error: { code, message, statusCode }, meta: meta() },
    { status: statusCode }
  )
}

export const ERRORS = {
  UNAUTHORIZED: () => apiError("UNAUTHORIZED", "Authentication required", 401),
  FORBIDDEN: () => apiError("FORBIDDEN", "You do not have access to this resource", 403),
  NOT_FOUND: (resource: string) => apiError(`${resource.toUpperCase()}_NOT_FOUND`, `${resource} not found`, 404),
  VALIDATION: (message: string) => apiError("VALIDATION_ERROR", message, 400),
  WORKSPACE_LIMIT: (limit = 20) => apiError("WORKSPACE_LIMIT_REACHED", `You've reached the maximum of ${limit} workspaces. Delete unused ones to create more.`, 403),
  AGENT_LIMIT: () => apiError("AGENT_LIMIT_REACHED", "Agent limit reached for your plan.", 403),
  ROLE_PROTECTED: (role: string) => apiError("ROLE_PROTECTED", `Cannot delete the ${role}. Every Claw needs exactly one.`, 400),
} as const
