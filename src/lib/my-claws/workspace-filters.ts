export const MY_CLAWS_FILTERS = [
  "All",
  "Running",
  "Paused",
  "Error",
  "Draft",
  "Setup",
  "Sleeping",
] as const

export type MyClawsFilter = (typeof MY_CLAWS_FILTERS)[number]

export type WorkspaceFilterStatus =
  | "running"
  | "paused"
  | "error"
  | "draft"
  | "setup"
  | "deploying"
  | "stopped"
  | "hibernated"
  | "waking"

/** Map filter pill label to workspace badge status from mapWorkspaceStatus. */
export function workspaceMatchesFilter(
  status: WorkspaceFilterStatus,
  filter: MyClawsFilter,
): boolean {
  if (filter === "All") return true
  if (filter === "Sleeping") return status === "hibernated"
  return status === filter.toLowerCase()
}
