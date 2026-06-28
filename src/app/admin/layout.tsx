import { requireAdminPage } from "@/lib/api/admin"
import AdminClientLayout from "./AdminClientLayout"

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdminPage()
  return (
    <AdminClientLayout>
      {children}
    </AdminClientLayout>
  )
}
