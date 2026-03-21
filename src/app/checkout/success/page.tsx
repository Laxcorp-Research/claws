import { redirect } from "next/navigation"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/db"

export default async function CheckoutSuccessPage() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) redirect("/auth/signin")

  const purchase = await prisma.purchase.findFirst({
    where: { userId: session.user.id, status: "COMPLETED", workspaceId: { not: null } },
    orderBy: { createdAt: "desc" },
  })

  if (purchase?.workspaceId) redirect(`/setup/${purchase.workspaceId}/step/1`)

  redirect("/my-claws")
}
