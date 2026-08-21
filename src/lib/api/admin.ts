import { getSessionUser } from '@/lib/api/auth'
import { getAdminEmails, isAdminEmail } from '@/lib/admin-emails'
import { notFound } from 'next/navigation'

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

export async function requireAdminPage() {
  const user = await getAdminUser()
  if (!user) {
    const configuredAdmins = getAdminEmails()
    if (configuredAdmins.length === 0) {
      console.warn(
        'ADMIN_EMAILS unset - page admin enforcement DISABLED, falling back to API requireAdmin',
      )
      return null
    }
    notFound()
  }
  return user
}
