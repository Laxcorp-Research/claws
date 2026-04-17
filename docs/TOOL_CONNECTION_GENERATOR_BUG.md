# Tool Connection Generator Bug

**Status:** Open — **LAUNCH BLOCKER**
**Severity:** Critical
**Discovered:** April 2026, during heartbeat system production-fix PR
**Masking mechanism:** `@ts-nocheck` on `src/lib/openclaw/generator.ts`

## Summary

`src/lib/openclaw/generator.ts` reads fields on the Prisma `ToolConnection` model that **do not exist**. The code is silently broken: every paid user who connects an external tool (Tavily, OpenAI, Anthropic-owned key, etc.) in the Builder UI ends up with an empty `skills.entries` object in their container's `openclaw.json`, and an invalid `TOOLS.md` with `### undefined` headers.

The bug is invisible in two ways:

1. **`@ts-nocheck`** at the top of `generator.ts` suppresses the 4 type errors that TypeScript would otherwise have surfaced on build.
2. **The generator tests** (`src/lib/openclaw/__tests__/generator.test.ts`) define a mock `toolConnections` record that contains all the phantom fields, so `it('includes tool connection credentials in skills entries', ...)` passes against the mock even though the production Prisma model can never produce that shape.

In production, every user who wires up a tool gets the connection saved in the DB, the UI shows "Connected," the container boots — and then no API key reaches the agent at runtime, because the `env` block of `skills.entries` never gets populated.

## Phantom fields referenced in `generator.ts`

Running `npx tsc --noEmit` after removing `@ts-nocheck` produces (paraphrased):

```
src/lib/openclaw/generator.ts:XXX - Property 'skillSlug' does not exist on type 'ToolConnection'.
src/lib/openclaw/generator.ts:XXX - Property 'envVarMapping' does not exist on type 'ToolConnection'.
src/lib/openclaw/generator.ts:XXX - Property 'toolName' does not exist on type 'ToolConnection'.
src/lib/openclaw/generator.ts:XXX - Property 'notes' does not exist on type 'ToolConnection'.
```

The four phantom fields and what the code tries to do with them:

| Phantom field      | Where used                                    | What it controls                                           |
|--------------------|-----------------------------------------------|------------------------------------------------------------|
| `skillSlug`        | `generateSkillsEntriesConfig` (line ~372)     | Keys the `skills.entries` map (determines which skill gets the env var). |
| `envVarMapping`    | `generateSkillsEntriesConfig`                 | `Record<envVarName, encryptedApiKey>` — what env vars the container gets. |
| `toolName`         | `generateToolsMd` (line ~992)                 | Display name used in the `### Heading` of `TOOLS.md`.      |
| `notes`            | `generateToolsMd`                             | Free-text notes rendered under each tool section.          |

## Actual `ToolConnection` model (from `prisma/schema.prisma`)

```prisma
model ToolConnection {
  id                   String   @id @default(cuid())
  workspaceId          String
  toolSlug             String
  displayName          String?
  encryptedApiKey      String?
  connectionType       String   // API_KEY | OAUTH | COMPOSIO
  status               String   // CONNECTED | ERROR | PENDING
  composioConnectionId String?
  composioEntityId     String?
  lastError            String?
  lastTestedAt         DateTime?
  // ...timestamps + workspace relation
}
```

No `skillSlug`, no `envVarMapping`, no `toolName`, no `notes`. There is `toolSlug` and `displayName`, but the generator doesn't read those.

## Production impact

- **Severity:** Every user who connects a tool in the Builder UI gets a broken container. Tools "work" in the UI (the connection is saved, the UI shows the API key as stored), but the agent running inside the container never receives the credentials. This means:
  - Tavily search agents can't search.
  - Any skill that requires an env var (which is most of them) will fail with "missing API key."
  - `TOOLS.md` for every deployed container has `### undefined` sections, which the orchestrator's LLM will ingest as garbled context.
- **User experience:** Looks like a correctly configured claw. Fails silently when the agent tries to act.
- **Discovery risk:** Bugs of this kind tend to be reported as "the agent isn't using my API key" or "tool calls are failing" — which users will attribute to LLM quality or the external API, not to our generator.

## Why the tests don't catch it

`src/lib/openclaw/__tests__/generator.test.ts` line 111-119:

```typescript
toolConnections: [
  {
    toolName: 'Tavily',                                    // phantom
    connectionType: 'API_KEY',
    skillSlug: 'tavily-search',                            // phantom
    envVarMapping: { TAVILY_API_KEY: 'encrypted-tavily-key' },  // phantom
    notes: null,                                           // phantom
  },
],
```

The mock shape matches the (broken) code, not the Prisma model. So the test passes. This is a classic "mock drifted from reality" bug.

**Any fix MUST include a test that runs against the REAL Prisma model shape** — ideally one that either uses an actual Prisma client against a test DB, or mocks the model via `Prisma.ToolConnectionGetPayload<{}>` so that adding/removing schema fields breaks the test at type-check time.

## What the fix requires

This is not a "rename four fields" change. A correct fix requires:

### 1. Schema decision: how do tools map to skills and env vars?

We need to decide the data model for answering these questions:

- **A tool is connected — which skill(s) does it authorize?**
  Options: (a) 1:1 (a tool is the skill), (b) 1:N (a tool provides multiple skills), (c) N:M (skills can use any of several tools). The current code implicitly assumes (a) via `skillSlug`, but the `Skill` table is a separate thing and the mapping was never persisted.

- **What env vars does each tool produce?**
  Options: (a) hardcoded per-tool registry ("tavily → TAVILY_API_KEY"), (b) persisted per connection (`envVarMapping` JSON column), (c) derived from Composio metadata. The current code assumes (b) but the column doesn't exist.

- **What's the display name / description for `TOOLS.md`?**
  Options: (a) use `displayName` + fallback to a registry, (b) add `toolName` / `description` columns. The current code reads `toolName` but the column doesn't exist; `displayName` exists but isn't read.

The likely right answer is an **in-code tool registry** (`src/lib/tools/registry.ts` keyed by `toolSlug`) that defines: name, description, env var names, required skill slug(s). Persisted fields stay minimal. But this decision has UX and product implications (how does the UI know which tools are available? how are new tools added?) that need sign-off.

### 2. End-to-end test for connected-tools pipeline

After the schema decision, add an integration test that:
- Creates a workspace with a real `ToolConnection` row (type-safe against `Prisma.ToolConnectionGetPayload`).
- Calls `generateWorkspace()`.
- Asserts that `openclaw.json` → `skills.entries[<slug>].env` contains the decrypted API key under the correct env var name.
- Asserts that the orchestrator's `TOOLS.md` contains a section with the tool's actual display name (no `undefined`).

### 3. Remove `@ts-nocheck`

Once the above are in place, `@ts-nocheck` can come off `generator.ts`. This PR **intentionally left it on** — removing it without first fixing the tool-connection bug would force the fix to happen in this PR (scope blow-up), or would require adding `@ts-ignore` on each of the 4 phantom references (which would be a worse state than the current single blanket directive).

## Why this is a launch blocker

1. It affects **100% of paid users** who connect any tool. The free tier may not exercise this path, but the moment a user adds Tavily or OpenAI, their agent breaks silently.
2. The silent-failure mode is the **worst possible**: the UI reports success, the container runs, the agent responds, but its tool calls all fail or return "missing credentials." Users will blame us for LLM quality.
3. The bug has likely been present since tool connections were added. Every tool-using claw deployed so far is affected.

## Do not proceed with

- New tool integrations in the Builder UI — more surface area for the bug.
- Marketing or onboarding flows that rely on Tavily / similar skills working out of the box.
- Enabling tool-connection features for new user cohorts.

## Related code

- `src/lib/openclaw/generator.ts` — `generateSkillsEntriesConfig` (~line 370), `generateToolsMd` (~line 990).
- `prisma/schema.prisma` — `ToolConnection` model.
- `src/lib/openclaw/__tests__/generator.test.ts` — tests with phantom-field mock.
- UI flow: `src/app/api/tools/` and `src/components/builder/tools-drawer.tsx` (wherever tool connections are persisted).

## Fix order

1. Confirm schema decision with the team.
2. Migrate `ToolConnection` (add fields or rely on a registry — either way, the Prisma model changes).
3. Rewrite the two broken functions in `generator.ts` to read the real shape.
4. Add the integration test (using real Prisma types, not a handwritten mock).
5. Remove `@ts-nocheck` from `generator.ts`.
6. Remove this document.

## Cross-references

- The heartbeat fix PR that discovered this bug: see commit introducing `buildHeartbeatSchedule` in `src/lib/openclaw/generator.ts`.
- The same PR fixed a separate latent bug where `deployer.ts` `calculateNextHeartbeat` treated `schedule` as a string when the generator emits an object. That fix does **not** depend on this one.
