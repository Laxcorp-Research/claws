import { apiSuccess } from '@/lib/api/response'
import { getAdminUser } from '@/lib/api/admin'

export async function GET() {
  const admin = await getAdminUser()
  return apiSuccess({ isAdmin: !!admin })
}
