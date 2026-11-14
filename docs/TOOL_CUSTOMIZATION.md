# Tool customization semantics

Workspace buyers own their claw's tool requirement set after install. The
marketplace / official template snapshot is never mutated by buyer edits.

## Ownership

| Layer | Role |
|-------|------|
| `ClawTemplate.workspaceSnapshot.tools[]` | Template defaults (shared by all buyers) |
| `Workspace.toolRequirements` | Per-workspace copy, seeded at install |

Legacy workspaces with `toolRequirements = null` dual-read from the template
snapshot via `resolveWorkspaceToolRequirements`. New installs always seed JSON.

## Ops (PATCH `/api/workspaces/[id]/tool-requirements`)

| Op | Effect |
|----|--------|
| `demote` | `required → false` (row moves to Recommended) |
| `dismiss` | Hide from Recommended (`dismissed: true`) |
| `undismiss` | Clear dismissed |
| `restore` | Re-hydrate that slug from template defaults |
| `remove` | Drop slug from the workspace set only |
| `swap` | Replace `slug` with catalog `replaceWith`, carrying `required`; keeps curated `alternatives[]` as Suggested pins |

**Suggested source:** `WorkspaceToolRequirement.alternatives` (seeded from `SeedTool.alternatives` → `ClawTemplate.workspaceSnapshot.tools[]`). Swap UI opens BrowseToolsModal (category-filtered library) with those slugs pinned under "Suggested".

`remove` does **not** delete `ToolConnection` rows. Disconnect / credential
deletion is a separate explicit action (REMOVE dialog checkbox, default on).

AI-provider slugs (`isAIProvider`) are rejected - they stay Step 1 domain.

## Deploy gate + Step 2

Both consume the workspace resolver (never live template JSON for gating).
`requiredToolsSatisfied` / `filterNonAiProviderRequiredEntries` are unchanged.

## Generator + drift

- Requirement-only edits (demote / dismiss / restore / remove without
  disconnect) do **not** change config fingerprint `tools` area - no drift
  banner; no redeploy required for the gate change alone.
- Disconnect / credential delete changes `ToolConnection` → fingerprint
  `tools` area dirty → Manage Tools / dashboard drift banner → redeploy
  regenerates `skills.entries` / `TOOLS.md`.
- Removed **and** disconnected tools emit nothing for that slug on the next
  `generateWorkspace`.

## Dependents warning

`resolveToolDependents` labels agents via:

1. **Structural** - `Skill.compatibleTools` → `AgentSkill` → Agent
2. **Prose** - SOUL.md / AGENTS.md / HEARTBEAT.md mention name or slug

Honest limit: paraphrases that omit the tool name/slug are undetectable;
many official templates seed empty `skills:[]` so prose is often the only hit.
