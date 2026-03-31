import { getSessionUser } from '@/lib/api/auth'

function getAdminEmails(): string[] {
  return (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean)
}

export function isAdminEmail(email: string): boolean {
  return getAdminEmails().includes(email.toLowerCase())
}

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
