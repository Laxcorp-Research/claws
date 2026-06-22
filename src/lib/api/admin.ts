import { getSessionUser } from '@/lib/api/auth'
import { getAdminEmails, isAdminEmail } from '@/lib/admin-emails'

// Admin allowlist logic now lives in the edge-safe '@/lib/admin-emails' module
// (so middleware can use it at the edge without pulling in getServerSession/
// Prisma). Re-exported here so existing server callers keep importing from
// '@/lib/api/admin'.
export { getAdminEmails, isAdminEmail }

export async function getAdminUser() {
  const user = await getSessionUser()
  if (!user || !user.email || !isAdminEmail(user.email)) {
    return null
  }
  return user
}

export async function requireAdmin() {
  const user = await getAdminUser()
  if (!user) {
    throw new Error('ADMIN_REQUIRED')
  }
  return user
}
