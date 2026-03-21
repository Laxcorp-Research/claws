import { prisma } from "@/lib/db"

export async function verifyWorkspaceOwnership(workspaceId: string, userId: string) {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
  })

  if (!workspace) return { error: "NOT_FOUND" as const, workspace: null }
  if (workspace.userId !== userId) return { error: "FORBIDDEN" as const, workspace: null }

  return { error: null, workspace }
}
