import { prisma } from "@/lib/db"

/**
 * Retire prior COMPLETED Deployment rows for a workspace as SUPERSEDED.
 *
 * "Current" = latest non-superseded success row (COMPLETED). Hibernate and
 * replace (deployToCloud) must call this so wake-cycle history stops matching
 * force-update / admin deployment counts.
 *
 * @param exceptDeploymentId — keep this row (the in-flight / new deploy) COMPLETED-eligible
 */
export async function supersedePriorDeployments(
  workspaceId: string,
  exceptDeploymentId?: string,
): Promise<number> {
  const result = await prisma.deployment.updateMany({
    where: {
      workspaceId,
      status: "COMPLETED",
      ...(exceptDeploymentId ? { id: { not: exceptDeploymentId } } : {}),
    },
    data: { status: "SUPERSEDED" },
  })
  return result.count
}
