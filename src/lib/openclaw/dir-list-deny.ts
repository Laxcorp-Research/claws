/**
 * Lifecycle P6 — platform mitigation for OpenClaw boot noise:
 * agents call file-transfer `dir_list` with node id `gateway`/`local` when no
 * paired node is registered → upstream "unknown node: gateway".
 *
 * Until paired nodes exist in our product shape, deny dir_list-class tools so
 * the agent gets an honest tool-policy error instead of gateway boot spam.
 *
 * Upstream filing (real fix): OpenClaw should no-op / clear error when
 * dir_list targets an unregistered node id — file against openclaw/openclaw
 * (node registry / file-transfer tools), not LaxClaws overlay.
 */
export const DIR_LIST_TOOL_DENY = ["dir_list"] as const

/**
 * Merge DIR_LIST_TOOL_DENY into a tools policy object (top-level or per-agent).
 * Merge, never clobber.
 */
export function mergeDirListDenyIntoTools(
  existingTools: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const tools = { ...(existingTools ?? {}) }
  const existingDeny = Array.isArray(tools.deny)
    ? (tools.deny as unknown[]).filter((d): d is string => typeof d === "string")
    : []
  const next = [...existingDeny]
  for (const name of DIR_LIST_TOOL_DENY) {
    if (!next.includes(name)) next.push(name)
  }
  tools.deny = next
  return tools
}
