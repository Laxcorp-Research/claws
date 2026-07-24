/**
 * Batch B follow-up: mark User.onboardingCompleted when the first workspace
 * is created, inside the same transaction as the create.
 *
 * Call AFTER the workspace row is inserted. count === 1 means this create
 * was the user's first workspace.
 */
export async function completeOnboardingAfterFirstWorkspace(
  tx: {
    workspace: { count: (args: { where: { userId: string } }) => Promise<number> }
    user: {
      update: (args: {
        where: { id: string }
        data: { onboardingCompleted: boolean }
      }) => Promise<unknown>
    }
  },
  userId: string,
): Promise<void> {
  const count = await tx.workspace.count({ where: { userId } })
  if (count !== 1) return
  await tx.user.update({
    where: { id: userId },
    data: { onboardingCompleted: true },
  })
}
