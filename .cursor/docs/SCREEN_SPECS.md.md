# Claws — Screen Composition Specs
## Every screen defined as a tree of named components with props
## Use with Claws_Design_System.md — components and pixel values are defined there

---

## How Cursor Uses This File

Each screen is a recipe: which components go where with what props. Build by assembling the named components.

**CRITICAL: When this file mentions abstract class names like `text-display` or `p-4`, IGNORE those values. Instead look up the component's pixel-exact spec in `docs/DESIGN_SYSTEM.md`.** The Design System Section 2 has exact pixel values for every component, and Section 3 has per-screen layout values. Those are the truth. This file defines STRUCTURE (what goes where). The Design System defines APPEARANCE (exact pixels).

Example: This file says `h1(text-display)`. The Design System Section 3 Screen 1 says the Store heading is `font-size 20px, font-weight 600`. Use `text-xl font-semibold`, NOT a custom `text-display` class.

---

## SCREEN 1: /store — Marketplace

```
PageShell(background="secondary")
  └─ div(max-w-5xl mx-auto px-4 py-4)
     ├─ div(text-center py-5)                         # Hero
     │  ├─ h1(text-display) → "AI agents that work while you sleep"
     │  ├─ p(text-body text-content-secondary mt-1 max-w-lg mx-auto) → "Build, customize, and deploy multi-agent AI teams. Browse official and community templates."
     │  └─ Input(placeholder="Search templates and skills..." className="max-w-[280px] mx-auto mt-3")
     │
     ├─ MarketplaceTabs(active="templates")            # Templates | Skills
     │
     ├─ div(flex gap-1.5 items-center mt-2 mb-3)      # Filters row
     │  ├─ Button(primary, sm) → "All"                 # Active category
     │  ├─ Button(outline, sm) → "Money-Making"
     │  ├─ Button(outline, sm) → "Creator"
     │  ├─ Button(outline, sm) → "Business Ops"
     │  ├─ Button(outline, sm) → "Vertical"
     │  ├─ Button(outline, sm) → "Lifestyle"
     │  ├─ div(w-px h-4 bg-border mx-1)               # Separator
     │  ├─ Button(outline, sm) → "Free"
     │  ├─ Button(outline, sm) → "Paid"
     │  ├─ div(w-px h-4 bg-border mx-1)               # Separator
     │  └─ Select(size="sm") → Sort: Popular / Newest / Price ↑ / Price ↓ / Rating
     │
     ├─ section                                        # Official section
     │  ├─ div(flex justify-between items-center mb-2)
     │  │  ├─ h2(text-title) → "Official"
     │  │  └─ TrustBadge(tier="OFFICIAL")
     │  └─ div(grid gap-2)                             # ClawCard stack
     │     ├─ ClawCard(template, trustBadge=OFFICIAL, creatorName="Claws Team")
     │     └─ ... (20 official templates, filtered by active category)
     │
     ├─ section                                        # Trending section
     │  ├─ h2(text-title mb-2) → "Trending"
     │  └─ div(grid gap-2)
     │     ├─ ClawCard(template, trustBadge, creatorName, installCount)
     │     └─ ... (community templates sorted by installs last 7 days)
     │
     └─ section                                        # New section
        ├─ h2(text-title mb-2) → "New"
        └─ div(grid gap-2)
           ├─ ClawCard(template, trustBadge, creatorName, installCount)
           └─ ... (newest published, paginated, cursor-based)

STATES:
  search-active: sections replaced by flat search results grid
  search-no-results: EmptyState(icon="🔍", title='No results for "{query}"', actions=[Button "Clear search"])
  skills-tab: replaces template content with skill sections (see SCREEN 1B below)
  loading: skeleton cards (3 per section)

DATA SOURCE: GET /api/marketplace/templates with filters/sort/pagination
```

### SCREEN 1B: /store (Skills tab)

```
Same page, Skills tab active in MarketplaceTabs.

     ├─ div(flex gap-1.5 items-center mt-2 mb-3)      # Category filters (ClawHub categories)
     │  ├─ Button(primary, sm) → "All"
     │  ├─ Button(outline, sm) → "Communication"
     │  ├─ Button(outline, sm) → "CRM"
     │  ├─ Button(outline, sm) → "Data"
     │  ├─ Button(outline, sm) → "Developer"
     │  ├─ Button(outline, sm) → "Email"
     │  ├─ Button(outline, sm) → "Finance"
     │  ├─ Button(outline, sm) → "Marketing"
     │  ├─ Button(outline, sm) → "Productivity"
     │  ├─ Button(outline, sm) → "Search"
     │  ├─ Button(outline, sm) → "Social"
     │  └─ Button(outline, sm) → "System"
     │
     ├─ section                                        # Official skills
     │  ├─ h2(text-title mb-2) → "Official"
     │  └─ div(grid grid-cols-2 gap-2)
     │     └─ SkillCard × N
     │
     └─ section                                        # Popular skills
        ├─ h2(text-title mb-2) → "Popular"
        └─ div(grid grid-cols-2 gap-2)
           └─ SkillCard × N (paginated)

DATA SOURCE: GET /api/marketplace/skills with filters/sort/pagination
```

---

## SCREEN 2: /store/[slug] — Template Detail

```
PageShell(background="secondary")
  └─ div(max-w-4xl mx-auto px-4 py-4)
     ├─ PageHeader(breadcrumb="← Back to store")
     ├─ div(flex justify-between items-start mb-4)     # Title + Purchase
     │  ├─ div
     │  │  ├─ div(flex gap-2 items-center)
     │  │  │  ├─ TrustBadge(tier)                      # ★ Official / ✓ Verified / ○ Unreviewed
     │  │  │  └─ CategoryBadge(category)
     │  │  ├─ h1(text-display mt-2) → template name
     │  │  ├─ p(text-body text-content-secondary mt-1) → tagline
     │  │  └─ div(flex gap-3 items-center mt-2)
     │  │     ├─ span(text-micro text-content-tertiary) → "{installCount} installs"
     │  │     ├─ span(text-micro text-content-tertiary) → "★ {avgRating} ({reviewCount} reviews)"
     │  │     └─ span(text-micro text-content-tertiary) → "OpenClaw ≥ {minOpenClawVersion}"
     │  └─ div(text-right)
     │     ├─ PriceDisplay(price, isFree)               # "$199" or "Free"
     │     └─ Button(primary, lg, className="mt-3")
     │        → "Purchase — ${price}" (if not owned)
     │        → "Deploy" (if owned, not deployed)
     │        → "Open Dashboard" (if owned and running)
     │
     ├─ Card(padding="md" className="mb-3")             # Agent pills
     │  ├─ h3(text-body-medium mb-2) → "Agents"
     │  └─ div(flex flex-wrap gap-1.5)
     │     └─ AgentPill × N (name, role, emoji)
     │
     ├─ Card(padding="md" className="mb-3")             # Tools required
     │  ├─ h3(text-body-medium mb-2) → "Tools Required"
     │  └─ div(space-y-2)
     │     └─ ToolRow × N
     │        ├─ icon/emoji
     │        ├─ tool name (text-body-medium)
     │        └─ connection type badge ("API Key" or "OAuth")
     │
     ├─ Card(padding="sm" className="mb-3 bg-surface-tertiary") # Estimated costs
     │  ├─ h3(text-body-medium mb-1.5) → "Estimated Monthly Cost"
     │  ├─ div(text-caption text-content-secondary) → "LLM (AI models): {estimatedMonthlyCost}"
     │  ├─ div(text-caption text-content-secondary) → "Platform fee: $79/mo"
     │  └─ div(text-caption font-semibold mt-1) → "Total: ~${estimate + 79}/mo + one-time template"
     │
     ├─ CreatorCard(creator)                            # Creator info
     │  # Official templates: avatar=Claws logo, name="Claws Team", badge=★ Official
     │  # Community: creator avatar, name, bio, stats, links to /creator/[id]
     │
     ├─ div(className="mb-3")                           # Full description
     │  ├─ h3(text-body-medium mb-2) → "About this Claw"
     │  └─ div(text-caption text-content-secondary leading-relaxed prose)
     │     → description (rendered markdown)
     │
     ├─ div(className="mb-3")                           # Reviews
     │  ├─ div(flex justify-between items-center mb-2)
     │  │  ├─ h3(text-body-medium) → "Reviews"
     │  │  └─ span(text-caption text-content-secondary) → "★ {avgRating} ({count} reviews)"
     │  ├─ ReviewCard × 5 (most recent first)
     │  ├─ Button(outline, sm) → "Show more" (if > 5 reviews)
     │  └─ Button(outline, sm, className="mt-2") → "Write a review"
     │     (only visible to users with a TemplateInstall record)
     │
     └─ div                                             # Similar templates
        ├─ h3(text-body-medium mb-2) → "Similar Templates"
        └─ div(grid grid-cols-3 gap-2)
           └─ ClawCard × 3 (same category, same price tier, by installCount desc)

STATES:
  already-owned: Purchase button → "Deploy" or "Open Dashboard"
  no-reviews: "No reviews yet. Be the first!" + "Write a review" button
  update-available: banner above agents section: "Template update available (v1 → v2)" + "Apply Update" button
  write-review-modal: overlay with ReviewStars input + title + body textarea + Submit

DATA SOURCE: GET /api/marketplace/templates/[slug] (includes creator, reviews, similar)
```
    Button(outline) → "Open Builder"

DATA SOURCE: ClawTemplate by slug, with workspaceSnapshot parsed for agent data
```

---

## SCREEN 3: /my-claws — Workspace List

```
PageShell
  └─ div(max-w-5xl mx-auto px-4 py-4)
     ├─ PageHeader(title="My Claws", actions=[Button(outline)"Browse store", Button(primary)"+ Create custom Claw"])
     │
     ├─ SearchFilterBar(                                # Only shown when 3+ workspaces
     │    search=true,
     │    filters=["All","Running","Paused","Error","Draft","Setup"],
     │    sort=["Last active","Name A-Z","Cost","Created"])
     │
     └─ div(grid grid-cols-3 gap-2.5)                   # Workspace grid
        ├─ WorkspaceCard(name, status, agentCount, lastActive, monthlyCost, source, onClick)
        ├─ WorkspaceCard(...)
        └─ WorkspaceCard(...)

STATE: empty (new user)
  EmptyState(icon="🤖", title="You don't have any Claws yet", description="Browse pre-built agent teams or create your own from scratch.", actions=[Button(primary)"Browse the store", Button(outline)"Create custom Claw"])

STATE: loading
  div(grid grid-cols-3 gap-2.5) → LoadingSkeleton(variant="card") × 3

DATA SOURCE: Workspace model filtered by userId, ordered by updatedAt desc
CLICK ROUTING: status→ RUNNING/PAUSED: /dashboard/[id], DRAFT: /builder/[id], SETUP_INCOMPLETE: /setup/[id]/step/[lastStep]
```

---

## SCREEN 4: /setup/[id]/step/1 — AI Models

```
PageShell
  └─ div(max-w-2xl mx-auto px-4 py-4)
     ├─ WizardProgressBar(steps=[{label:"AI model", status:"current"}, {label:"Tools", status:"upcoming"}, {label:"Deploy", status:"upcoming"}, {label:"Channels", status:"upcoming"}, {label:"Go live", status:"upcoming"}])
     │
     ├─ h2(text-title mb-0.5) → "Choose AI models for your agents"
     ├─ p(text-caption text-content-secondary mb-3.5) → subtitle
     │
     ├─ Card(padding="md" className="mb-3.5")           # API key input
     │  ├─ h3(text-body-medium mb-1.5) → "Your API key"
     │  ├─ div(flex gap-2 items-center)
     │  │  ├─ Input(monospace, placeholder="sk-ant-api03-...")
     │  │  └─ Button(primary, md) → "Validate"
     │  └─ p(text-nano text-content-secondary mt-1) → help link
     │
     ├─ ModelSelectionTable(rows=[...agents with role, recommended, dropdown])
     │
     ├─ div(bg-surface-secondary rounded p-2.5 text-micro text-content-secondary mb-3.5) → recommendations explanation + cost estimate
     │
     └─ div(flex justify-end)
        └─ Button(primary, md) → "Next: Connect tools →"

STATE: api-key-error
  Card border changes to border-status-error, input border to border-status-error
  Error text below input: text-nano text-status-error → "This API key is invalid..."

DATA SOURCE: Workspace agents (from template), UserApiKey model
NEXT: /setup/[id]/step/2 (disabled until valid API key)
```

---

## SCREEN 5: /setup/[id]/step/2 — Connect Tools

```
PageShell
  └─ div(max-w-2xl mx-auto px-4 py-4)
     ├─ WizardProgressBar(steps=[{..complete}, {..current: "Tools"}, {..upcoming}×3])
     │
     ├─ ToolConnectionList(title="Required tools", subtitle="Must be connected before deployment", tools=[...required])
     │
     ├─ ToolConnectionList(title="Recommended tools", subtitle="Pre-selected. Connect or swap.", tools=[...recommended])
     │
     ├─ div(flex gap-2.5 mb-3.5)                       # Extra tool actions
     │  ├─ Button(outline, md, className="flex-1") → "+ Browse 500+ tools (Composio)"
     │  └─ Button(outline, md, className="flex-1") → "+ Connect custom API"
     │
     └─ div(flex justify-between)
        ├─ Button(outline, md) → "← Back"
        └─ div(flex gap-1.5)
           ├─ Button(outline, md) → "Skip optional"
           └─ Button(primary, md) → "Next: Deploy →"

MODALS triggered from this screen:
  - "Enter API key" → ApiKeyModal(toolName, helpUrl, onSave)
  - "Connect via OAuth" → opens Composio popup, ToolRow shows StatusDot connecting
  - "Swap" → ToolSwapModal(category, alternatives[], onSelect)
  - "Browse 500+" → BrowseToolsModal(onConnect)
  - "Connect custom API" → CustomApiModal(onSave)

DATA SOURCE: ClawTemplate.requiredTools + optionalTools, ToolConnection model
NEXT: /setup/[id]/step/3 (disabled until all required tools green)
```

---

## SCREEN 6: /setup/[id]/step/3 — Deploy

```
PageShell
  └─ div(max-w-2xl mx-auto px-4 py-4)
     ├─ WizardProgressBar([complete, complete, current:"Deploy", upcoming, upcoming])
     │
     ├─ h2(text-title mb-0.5) → "Deploy your Claw"
     ├─ p(text-caption text-content-secondary mb-3.5) → "Your Claw will run 24/7 on our managed cloud. $79/mo after your 3-day trial."
     │
     ├─ Card(padding="md", className="mb-4")              # Deploy action
     │  ├─ div(flex justify-between items-center)
     │  │  ├─ div
     │  │  │  ├─ h3(text-title) → "Cloud deployment"
     │  │  │  └─ p(text-caption text-content-secondary mt-0.5) → "Managed container · Auto-updates · Health monitoring · 24/7 uptime"
     │  │  └─ Button(primary, md) → "Deploy"
     │
     ├─ Card(padding="md")                              # Progress (shown after clicking Deploy)
     │  ├─ h3(text-body-medium mb-2) → "Deployment progress"
     │  └─ DeployProgress(steps=[{label:"Building config", status:"complete"}, ...])
     │
     └─ div(flex justify-between mt-4)
        ├─ Button(outline) → "← Back"
        └─ Button(primary, disabled=!deployed) → "Next: Channels →"

STATE: deploy-failed
  DeployProgress last step: status="failed"
  AlertBanner(variant="error", title="Container health check failed", description="...", actions=[Button "Retry", Button "Check tools", Button "View logs"])

DATA SOURCE: Deployment model status
NEXT: /setup/[id]/step/4 (disabled until deployment COMPLETED or zip downloaded)
```

---

## SCREEN 7: /setup/[id]/step/4 — Connect Channels

```
PageShell
  └─ div(max-w-2xl mx-auto px-4 py-4)
     ├─ WizardProgressBar([complete×3, current:"Channels", upcoming])
     │
     ├─ h2(text-title mb-0.5) → "How should your Claw talk to you?"
     ├─ p(text-caption text-content-secondary mb-3.5) → subtitle
     │
     ├─ div(border border-border rounded-lg overflow-hidden)   # Channel list
     │  ├─ ToolRow(name="Web chat", desc="Built-in — always available", status="connected") # Always active
     │  ├─ ToolRow(name="WhatsApp", desc="Scan QR code", status="disconnected", connectionType="CHANNEL_NATIVE")
     │  ├─ ToolRow(name="Microsoft Teams", desc="Azure Bot setup", ...)
     │  ├─ ToolRow(name="Telegram", desc="Enter bot token", ...)
     │  ├─ ToolRow(name="Slack", desc="Connect via OAuth", connectionType="OAUTH_COMPOSIO")
     │  └─ ToolRow(name="Discord", desc="Enter bot token", ...)
     │
     └─ div(flex justify-between mt-4)
        ├─ Button(outline) → "← Back"
        └─ Button(primary) → "Next: Go live →"

DATA SOURCE: ToolConnection model with connectionType=CHANNEL_NATIVE
NEXT: /setup/[id]/step/5 (web chat counts as minimum 1 channel)
```

---

## SCREEN 8: /setup/[id]/step/5 — Go Live

```
PageShell
  └─ div(max-w-2xl mx-auto px-4 py-4)
     ├─ WizardProgressBar([complete×4, {label:"Live!", status:"complete" with green bg}])
     │
     └─ div(text-center py-8)                           # Celebration
        ├─ div(text-4xl mb-2) → "🎉"
        ├─ h2(text-display mb-1) → "Your {clawName} is live!"
        ├─ p(text-body text-content-secondary mb-1) → "Your agents are starting up now."
        │
        ├─ div(text-left max-w-lg mx-auto bg-surface-secondary rounded p-4 mt-4 text-caption text-content-secondary leading-loose)
        │  → "Next few minutes: Orchestrator introduces itself..."
        │  → "Tomorrow 8:00 AM: First daily briefing..."
        │  → Quick tips (message orchestrator, check dashboard, open builder)
        │
        └─ div(flex gap-2 justify-center mt-5)
           ├─ Button(primary, lg) → "Open Dashboard"
           └─ Button(outline, lg) → "Customize in Builder"

DATA SOURCE: Workspace model
ACTIONS: "Open Dashboard" → /dashboard/[id], "Customize" → /builder/[id]
SIDE EFFECT: Updates workspace.status to RUNNING
```

---

## SCREEN 9: /builder/[id] — Visual Agent Builder

```
PageShell
  └─ div(flex-1 flex flex-col)
     ├─ div(flex items-center justify-between px-3 py-2 border-b border-border)  # Builder top bar
     │  ├─ div(flex items-center gap-2)
     │  │  ├─ Input(text-title, value=workspaceName, editable)
     │  │  └─ StatusBadge(status=workspace.status)
     │  └─ div(flex gap-1.5)
     │     ├─ Button(ghost, sm) → "History" (opens version panel)
     │     ├─ Button(outline, sm) → "Manage Tools"         # → /setup/[id]/step/2
     │     ├─ Button(outline, sm) → "Dashboard"             # → /dashboard/[id]
     │     ├─ Button(outline, sm) → "Test Run"
     │     ├─ Button(outline, sm) → "Publish"               # → /publish/template (creator enrollment check first)
     │     └─ Button(primary, sm) → "Deploy"                # → /setup/[id]/step/3
     │
     ├─ div(flex-1 grid grid-cols-[200px_1fr_200px])
     │  ├─ div(border-r border-border p-2.5 overflow-y-auto)  # Left sidebar
     │  │  ├─ h4(text-nano-medium text-content-secondary uppercase tracking-wider mb-2) → "Agents"
     │  │  ├─ AgentListItem × N (role indicator + name, click to select)
     │  │  ├─ Button(outline, sm, className="w-full mt-2") → "+ Add worker"
     │  │  ├─ h4(same styling, mt-4) → "Skills"
     │  │  └─ SkillListItem × N (category icon + name)
     │  │
     │  ├─ div(bg-surface-secondary relative)               # Canvas (React Flow)
     │  │  └─ ReactFlow
     │  │     ├─ AgentNode(role="ORCHESTRATOR", name, model, selected?) — positioned top center, larger
     │  │     ├─ AgentNode(role="WORKER", name, color, model) × N — positioned below orchestrator
     │  │     ├─ AgentNode(role="CRITIC", name, model) — positioned bottom center, purple
     │  │     └─ Edges between nodes (labeled with ConnectionCondition)
     │  │
     │  └─ div(border-l border-border p-2.5 overflow-y-auto)  # Right panel
     │     └─ PropertiesPanel(selectedAgent)
     │        ├─ h4 → "Properties — {agentName}"
     │        ├─ Label + StatusBadge (role)
     │        ├─ Label + Select (model dropdown)
     │        ├─ Label + TextArea (SOUL.md — markdown editor)
     │        ├─ Label + TextArea (AGENTS.md)
     │        ├─ Label + SkillPicker (checkboxes for assigned skills)
     │        ├─ Label + Select (Reports to)
     │        ├─ Label + Select (Outputs to)
     │        └─ If CRITIC: Label + Slider (quality threshold, default 8.0)
     │
     └─ div(border-t border-border px-3 py-2)               # Bottom bar
        └─ HeartbeatConfig: "Run every: [Select: weekday/daily/hourly] at [Select: time]"

STATE: empty (new custom Claw)
  Canvas shows:
    EmptyState(icon="🤖", title="Start building your agent team", description="Every Claw starts with an Orchestrator.", actions=[Button(primary)"+ Add Orchestrator"])
  Left sidebar: empty agent list + "Add Orchestrator" prompt
  Right panel: workspace overview (name, creation date)

STATE: no-agent-selected
  Right panel shows workspace overview instead of PropertiesPanel

DATA SOURCE: Workspace with agents, connections, skills via builderStore (Zustand)
AUTO-SAVE: Every change debounced 2 seconds → PATCH /api/agents/[workspaceId]/[agentId]
```

---

## SCREEN 10: /dashboard/[id] — Live Dashboard

```
PageShell
  └─ div(max-w-5xl mx-auto px-4 py-4)
     ├─ PageHeader(
     │    title=workspaceName,
     │    actions=[Button(outline,sm)"Edit in Builder", Button(outline,sm)"Manage Tools", Button(outline,sm)"Pause"])
     │  + StatusBadge inline with title
     │
     ├─ AlertBanner (if applicable — tool expired, spend warning, spend limit, container error)
     │
     ├─ div(grid grid-cols-4 gap-2)                     # Stats
     │  ├─ StatCard(label="Agents running", value=7, trend="All healthy", trendType="positive")
     │  ├─ StatCard(label="Tasks today", value=23, trend="+8 vs yesterday", trendType="positive")
     │  ├─ StatCard(label="API cost (March)", value="$47.20", trend="On track: $142/mo", trendType="neutral")
     │  └─ StatCard(label="Pending review", value=3, alert=true, trend="Action needed", trendType="negative")
     │
     ├─ PendingApprovals (if pendingCount > 0)          # Approval section
     │  └─ div(border border-status-warning rounded p-3 bg-status-warning-bg mb-3)
     │     ├─ h4(text-caption-medium text-amber-900 mb-1.5) → "Pending your approval (N items)"
     │     └─ PendingApprovalCard × N
     │
     └─ div(grid grid-cols-[1fr_280px] gap-3)           # Main content
        ├─ div(border border-border rounded-lg p-3)     # Activity feed
        │  ├─ h4(text-body-medium mb-2) → "Live agent activity"
        │  └─ div(max-h-[400px] overflow-y-auto)
        │     └─ ActivityLogEntry × N (SSE real-time, newest at top)
        │
        └─ div(flex flex-col gap-3)                     # Right sidebar
           ├─ div(border border-border rounded-lg p-3)
           │  ├─ h4(text-body-medium mb-2) → "Agent status"
           │  └─ AgentStatusRow × N
           │
           └─ CostBreakdownTable(rows, totalCost, period, optimizationTip)

STATE: paused
  AlertBanner(variant="warning", title="This Claw is paused", description="Agents stopped. Pending tasks queued.", actions=[Button(primary,sm)"Resume agents"])
  StatCards: opacity-50, agents value="Paused"

STATE: error (container crash)
  AlertBanner(variant="error", title="Agent container not responding", description="Last healthy: 23 min ago. Auto-restart: 2 of 3.", actions=[Button(danger,sm)"Force restart", Button(outline,sm)"View logs", Button(outline,sm)"Check tools"])

STATE: tool-expired
  AlertBanner(variant="warning", title="HubSpot connection expired", description="OAuth token expired. Pipeline Manager degraded.", actions=[Button(primary,sm)"Reconnect", Button(outline,sm)"Manage tools"])

STATE: spend-warning (80%)
  AlertBanner(variant="warning", title="API spend at 82% of $200 limit", actions=[Button(outline,sm)"Increase limit", Button(outline,sm)"Optimize costs"])

STATE: spend-limit (100%)
  AlertBanner(variant="error", title="Monthly API spend limit reached", description="All agents paused.", actions=[Button(primary,sm)"Increase limit"])

DATA SOURCE: Workspace, ActivityLog (SSE stream), agent health from /api/deploy/[id]/health, cost from ActivityLog aggregation
```

---

## SCREEN 11: /settings — Settings

```
PageShell
  └─ div(max-w-3xl mx-auto px-4 py-4)
     ├─ div(flex border-b border-border mb-4)           # Tabs
     │  ├─ Tab("Account", active=false)
     │  ├─ Tab("API Keys", active=true)                  # Default tab
     │  ├─ Tab("Billing", active=false)
     │  ├─ Tab("Security", active=false)
     │  └─ Tab("Creator", active=false)                  # → /settings/creator (Screen 17)
     │
     └─ Tab content (varies)

TAB: API Keys
  ├─ h2(text-title mb-0.5) → "AI model API keys"
  ├─ p(text-micro text-content-secondary mb-3) → "These power all your Claws."
  └─ div(border border-border rounded-lg overflow-hidden)
     ├─ ToolRow(name="Anthropic (Claude)", desc="sk-ant-...x7Qq · Added Mar 12", status="connected", actions=[Button(ghost,sm)"Test", Button(danger ghost,sm)"Remove"])
     ├─ ToolRow(name="OpenAI (GPT)", desc="Not connected", status="disconnected", actions=[Button(primary,sm)"Add API key"])
     └─ ToolRow(name="Google (Gemini)", desc="Not connected", status="disconnected", actions=[Button(primary,sm)"Add API key"])

TAB: Billing
  ├─ h2(text-title mb-0.5) → "Billing summary"
  ├─ p(text-micro text-content-secondary mb-3) → "You pay $79/mo per running Claw. No tiers, no surprises."
  │
  ├─ div(grid grid-cols-3 gap-2 my-2.5)
  │  ├─ StatCard(label="Active Claws", value=N, trend="$79/mo each")
  │  ├─ StatCard(label="Monthly total", value="$XX", trend="Platform fees only")
  │  └─ StatCard(label="Trial status", value="Active" | "Used" | "Available",
  │     trend="Expires {date}" | "Started {date}" | "3 days on first deploy")
  │
  ├─ div(border border-[var(--bd)] rounded-[var(--r)] p-3 mb-3)  # Active subscriptions
  │  ├─ h3(text-body-medium mb-2) → "Active subscriptions"
  │  └─ div(flex flex-col gap-1.5)
  │     └─ per workspace: name + StatusBadge + "$79/mo" + next billing date
  │
  └─ div(flex gap-1.5)
     ├─ Button(outline)"Manage subscription"  → Dodo Payments portal
     └─ Button(outline)"View invoices"        → Dodo Payments portal

TAB: Account
  Basic profile form: name, email, avatar

TAB: Security
  Connected OAuth providers, active sessions, 2FA (future)
```

---

## SCREEN 12: /pricing — Platform Pricing

```
PageShell
  └─ div(max-w-4xl mx-auto px-4 py-6 text-center)
     ├─ h1(text-display mb-1) → "Simple pricing"
     ├─ p(text-body text-content-secondary mb-5) → "Buy a template. Pay monthly to run it. No tiers."
     │
     ├─ div(border-2 border-[var(--tx)] rounded-[var(--rl)] p-5 mb-4 text-center)  # Platform fee card
     │  ├─ p(text-[11px] font-semibold tracking-wide uppercase text-[var(--tx3)] mb-1) → "Platform fee"
     │  ├─ div(text-[32px] font-bold) → "$79"
     │  ├─ p(text-[13px] text-[var(--tx2)]) → "per month, per running Claw"
     │  ├─ div(text-left text-[12px] text-[var(--tx2)] mt-3 leading-relaxed)  # Feature list
     │  │  "Everything included: cloud hosting, all channels, 500+ tool integrations,
     │  │   visual builder, real-time monitoring, auto-restart, template updates, priority support"
     │  └─ p(text-[12px] text-[var(--tx2)] mt-3) → "One Claw? $79/mo. Two? $158/mo. Three? $237/mo. Linear, predictable. 10+ Claws? Contact us."
     │
     ├─ p(text-[11px] font-semibold tracking-wide uppercase text-[var(--tx3)] mb-2 text-left) → "Templates — one-time purchase, yours forever"
     │
     ├─ div(grid grid-cols-3 gap-2 mb-4)               # Template tier cards
     │  ├─ div(border border-[var(--bd)] rounded-[var(--r)] p-[12px_14px])
     │  │  ├─ Badge(green) → "Standard"
     │  │  ├─ div(text-[22px] font-bold) → "$149"
     │  │  ├─ p(text-[11px] text-[var(--tx3)] mt-[2px]) → "8 templates"
     │  │  └─ p(text-[11px] text-[var(--tx2)] mt-[6px]) → "Creator + Lifestyle"
     │  ├─ div(border border-[var(--bd)] rounded-[var(--r)] p-[12px_14px])
     │  │  ├─ Badge(blue) → "Business"
     │  │  ├─ div(text-[22px] font-bold) → "$199"
     │  │  ├─ p(text-[11px] text-[var(--tx3)] mt-[2px]) → "11 templates"
     │  │  └─ p(text-[11px] text-[var(--tx2)] mt-[6px]) → "Business Ops + Vertical"
     │  └─ div(border border-[var(--bd)] rounded-[var(--r)] p-[12px_14px])
     │     ├─ Badge(gold) → "Premium"
     │     ├─ div(text-[22px] font-bold) → "$299"
     │     ├─ p(text-[11px] text-[var(--tx3)] mt-[2px]) → "1 template"
     │     └─ p(text-[11px] text-[var(--tx2)] mt-[6px]) → "Quant Trader"
     │
     ├─ div(border border-[var(--bd)] rounded-[var(--rl)] p-[14px] text-left mb-4)  # How pricing works
     │  ├─ h3(text-[13px] font-semibold mb-[6px]) → "How pricing works"
     │  └─ p(text-[12px] text-[var(--tx2)] leading-relaxed)
     │     "1. Template purchase — $149, $199, or $299 one-time. Pick a pre-built Claw. Yours forever on the platform.
     │      2. Platform fee — $79/mo per running Claw. Everything included: hosting, channels, integrations, monitoring, updates.
     │      3. AI model costs — You bring your own API keys (Anthropic, OpenAI, Google). Pay your provider directly. Typical: $30-90/mo.
     │      4. 3-day free trial — Your first deploy includes a free trial. No platform fee until day 4."
     │
     └─ p(text-[12px] text-[var(--tx2)]) → "3-day free trial on your first deploy. No platform fee charged until day 4."

NO STATES (static page, no toggles, no annual pricing)

DATA SOURCE: Hardcoded. No API calls needed.
```

---

## SCREEN 13: /auth/signin — Authentication

```
PageShell
  └─ div(max-w-sm mx-auto py-8 text-center)
     ├─ h1(text-display mb-1) → "Welcome to Claws"
     ├─ p(text-body text-content-secondary mb-5) → "Sign in to manage your AI agent teams"
     │
     ├─ button(auth-oauth-btn) → GitHub icon + "Continue with GitHub"
     ├─ button(auth-oauth-btn) → Google icon + "Continue with Google"
     │  # auth-oauth-btn: flex items-center justify-center gap-2 w-full py-2.5 border border-border rounded text-body cursor-pointer hover:bg-surface-secondary transition-colors
     │
     ├─ div(flex items-center my-3.5)                   # Divider
     │  ├─ div(flex-1 h-px bg-border)
     │  ├─ span(mx-2.5 text-micro text-content-tertiary) → "or"
     │  └─ div(flex-1 h-px bg-border)
     │
     ├─ Input(type="email", placeholder="Email address")
     ├─ Button(primary, lg, className="w-full mt-2") → "Send magic link"
     │
     └─ p(text-nano text-content-tertiary mt-3.5) → "By signing in, you agree to..."

STATE: error
  AlertBanner(variant="error", title="Authentication failed", description="Please try again or use a different method.")
  Placed between title and OAuth buttons.

STATE: magic-link-sent
  Replace email input + button with:
  AlertBanner(variant="success", title="Check your email", description="We sent a magic link to {email}. Click it to sign in.")
```

---

## SCREEN 14: /onboarding — First-Time Welcome

```
PageShell
  └─ div(max-w-xl mx-auto py-6 text-center)
     ├─ h1(text-display mb-1) → "Welcome to Claws"
     ├─ p(text-body text-content-secondary mb-5) → "Let's get your first AI agent team running."
     │
     ├─ div(flex flex-col gap-3 mb-4)                   # Steps
     │  ├─ OnboardingStep(number=1, title="Add your AI model key", description="Your agents need an AI model to think.", actions=[Button(primary,sm)"Add Anthropic key", Button(outline,sm)"Add OpenAI key", Link"Where do I get a key?"])
     │  ├─ OnboardingStep(number=2, title="Pick your first Claw", description="Choose a pre-built team or create your own.", actions=[Button(primary,sm)"Browse the store", Button(outline,sm)"Create custom Claw"])
     │  └─ OnboardingStep(number=3, title="Connect tools & deploy", description="The setup wizard guides you through.", disabled=true)
     │
     └─ a(text-micro text-brand) → "Skip onboarding →"

STATE: step-1-complete
  Step 1: completed=true (shows green check instead of number)
  Step 2: becomes primary focus
  Step 3: still disabled
```

---

## MODAL SPECS

### ApiKeyModal
```
Modal(size="md", title="Connect {toolName}")
  ├─ p(text-caption text-content-secondary mb-3.5) → "Enter your API key. Encrypted with AES-256-GCM."
  ├─ Label → "API Key"
  ├─ Input(monospace, placeholder=toolPlaceholder)
  ├─ p(text-nano text-content-secondary mt-1) → Link "Where do I find this? →"
  └─ Footer: Button(outline)"Cancel" + Button(primary)"Validate & save"

STATES: validating (spinner on button), success (green text below input), error (red border + red text)
```

### BrowseToolsModal
```
Modal(size="lg", title="Browse tools")
  ├─ p(text-caption text-content-secondary mb-3) → "Connect any of 500+ tools via Composio."
  ├─ Input(placeholder="Search tools...")
  ├─ div(flex gap-1.5 flex-wrap my-2.5) → category filter Button(outline,sm) × 8
  ├─ div(border border-border rounded-lg overflow-hidden)
  │  └─ ToolRow × N (from Composio catalog, filtered by search + category)
  └─ Footer: Button(outline)"Close"
```

### CustomApiModal
```
Modal(size="md", title="Connect a custom API")
  ├─ p(text-caption text-content-secondary mb-3.5) → description
  ├─ Label "Tool name" + Input(placeholder="e.g., Our Internal CRM")
  ├─ Label "Base URL" + Input(monospace, placeholder="https://api.example.com/v1")
  ├─ Label "Auth type" + Select(options=["API Key (header)","Bearer Token","Basic Auth","Query Parameter"])
  ├─ Label "Credential" + Input(type="password", monospace)
  ├─ Label "Description" + TextArea(placeholder="Describe what this API does...")
  └─ Footer: Button(outline)"Cancel" + Button(primary)"Test & save"
```

### ToolSwapModal
```
Modal(size="md", title="Swap {category}: Choose an alternative to {currentTool}")
  ├─ div(flex gap-1.5 flex-wrap)
  │  └─ Card(hover=true, padding="sm") × N → alternative tool names
  ├─ p(text-nano text-content-secondary mt-2) → "All alternatives work identically."
  └─ Footer: Button(outline)"Cancel"
  On select: closes modal, updates ToolRow to new tool (disconnected state)
```

### ConfirmDialog
```
Modal(size="sm", title=confirmTitle)
  ├─ p(text-caption text-content-secondary) → description
  ├─ AlertBanner(variant="error") → if destructive, show warning
  └─ Footer: Button(outline)"Cancel" + Button(variant=confirmVariant) → confirmLabel

Used for: Delete Claw (danger), Pause agents (warning), Remove tool (danger)
```

---

## SCREEN 15: /store/skills/[slug] — Skill Detail

```
PageShell(background="secondary")
  └─ div(max-w-4xl mx-auto px-4 py-4)
     ├─ PageHeader(breadcrumb="← Back to skills")
     ├─ div(flex justify-between items-start mb-4)     # Title + Install
     │  ├─ div
     │  │  ├─ div(flex gap-2 items-center)
     │  │  │  ├─ TrustBadge(tier)
     │  │  │  ├─ span(text-caption) → category badge
     │  │  │  └─ span(text-micro text-content-tertiary) → "{installCount} installs"
     │  │  ├─ h1(text-display mt-2) → skill name (with emoji if present)
     │  │  └─ p(text-body text-content-secondary mt-1) → description
     │  └─ div(text-right)
     │     ├─ PriceDisplay(price, isFree)
     │     └─ Button(primary, lg, className="mt-3") → "Install to Workspace"
     │
     ├─ Card(padding="md" className="mb-3")             # SKILL.md preview
     │  ├─ h3(text-body-medium mb-2) → "Instructions"
     │  └─ div(prose text-caption leading-relaxed max-h-[400px] overflow-auto)
     │     → rendered markdown of SKILL.md content
     │
     ├─ Card(padding="md" className="mb-3")             # Requirements
     │  ├─ h3(text-body-medium mb-2) → "Requirements"
     │  ├─ div(mb-2)
     │  │  ├─ span(text-micro font-semibold) → "Binaries:"
     │  │  └─ span(text-micro text-content-secondary) → requiredBins.join(", ") or "None"
     │  └─ div
     │     ├─ span(text-micro font-semibold) → "Environment variables:"
     │     └─ div(mt-1)
     │        └─ code(text-micro bg-surface-tertiary px-1.5 py-0.5 rounded) × N → each env var name
     │
     ├─ CreatorCard(creator)                            # Creator info
     │
     ├─ div(className="mb-3")                           # Reviews
     │  ├─ div(flex justify-between items-center mb-2)
     │  │  ├─ h3(text-body-medium) → "Reviews"
     │  │  └─ span(text-caption text-content-secondary) → "★ {avgRating} ({count})"
     │  ├─ ReviewCard × 5
     │  └─ Button(outline, sm) → "Write a review" (verified installers only)
     │
     └─ div(text-micro text-content-tertiary mt-4)
        → "Compatible with OpenClaw ≥ {minOpenClawVersion}"

STATES:
  install-modal: overlay with workspace selector dropdown → "Install to {workspaceName}" button
  already-installed: Install button → "Installed ✓" (disabled)
  no-reviews: "No reviews yet."

DATA SOURCE: GET /api/marketplace/skills/[slug]
```

---

## SCREEN 16: /creator/[id] — Creator Profile (Public)

```
PageShell(background="secondary")
  └─ div(max-w-4xl mx-auto px-4 py-4)
     ├─ div(flex gap-4 items-start mb-4)               # Profile header
     │  ├─ img(w-16 h-16 rounded-full object-cover)   # Avatar
     │  └─ div
     │     ├─ div(flex gap-2 items-center)
     │     │  ├─ h1(text-display) → displayName
     │     │  └─ TrustBadge(tier=VERIFIED) (if any template is VERIFIED)
     │     ├─ p(text-body text-content-secondary mt-1) → bio
     │     └─ div(flex gap-3 mt-2)                     # Social links
     │        ├─ a(text-micro text-brand hover:text-primary) → Twitter icon + handle
     │        ├─ a(text-micro text-brand hover:text-primary) → GitHub icon + handle
     │        └─ a(text-micro text-brand hover:text-primary) → Website icon + URL
     │
     ├─ div(grid grid-cols-4 gap-2 mb-4)               # Stats
     │  ├─ StatCard(label="Templates", value=totalTemplates)
     │  ├─ StatCard(label="Skills", value=totalSkills)
     │  ├─ StatCard(label="Total Installs", value=totalInstalls)
     │  └─ StatCard(label="Avg Rating", value="★ {averageRating}")
     │
     ├─ div(className="mb-4")                          # Published templates
     │  ├─ h2(text-title mb-2) → "Templates"
     │  └─ div(grid gap-2)
     │     └─ ClawCard × N (this creator's published templates)
     │
     └─ div                                             # Published skills
        ├─ h2(text-title mb-2) → "Skills"
        └─ div(grid grid-cols-2 gap-2)
           └─ SkillCard × N (this creator's published skills)

STATES:
  no-templates: "No templates published yet."
  no-skills: "No skills published yet."
  inactive-creator: "This creator is no longer active." (isActive = false)

DATA SOURCE: GET /api/creator/[id]
```

---

## SCREEN 17: /settings/creator — Creator Dashboard

```
PageShell
  └─ SettingsLayout(activeTab="creator")               # Reuses settings layout with new tab
     │
     ├─ IF NOT ENROLLED:
     │  └─ Card(padding="lg" className="text-center max-w-md mx-auto")
     │     ├─ h2(text-title) → "Become a Creator"
     │     ├─ p(text-caption text-content-secondary mt-1) → "Publish templates and skills on the Claws marketplace. Keep 100% of your revenue."
     │     └─ Button(primary, lg, className="mt-3") → "Get Started"
     │        → links to enrollment form (below)
     │
     ├─ IF ENROLLED:
     │  ├─ Card(padding="md" className="mb-3")          # Profile editor
     │  │  ├─ h3(text-body-medium mb-2) → "Your Profile"
     │  │  ├─ div(grid grid-cols-2 gap-3)
     │  │  │  ├─ Input(label="Display Name", value=displayName)
     │  │  │  ├─ Input(label="Website", value=websiteUrl)
     │  │  │  ├─ Input(label="Twitter", value=twitterUrl)
     │  │  │  └─ Input(label="GitHub", value=githubUrl)
     │  │  ├─ Textarea(label="Bio", value=bio, maxLength=500)
     │  │  ├─ AvatarUpload(current=avatarUrl)
     │  │  └─ Button(primary, sm) → "Save Profile"
     │  │
     │  ├─ Card(padding="md" className="mb-3")          # Earnings
     │  │  ├─ h3(text-body-medium mb-2) → "Earnings"
     │  │  ├─ div(grid grid-cols-3 gap-2)
     │  │  │  ├─ StatCard(label="Total Earned", value="$1,234")
     │  │  │  ├─ StatCard(label="Pending Payout", value="$89")
     │  │  │  └─ StatCard(label="Next Payout", value="Mar 28")
     │  │  └─ Button(outline, sm, className="mt-2") → "Payout Settings"
     │  │     → links to Dodo beneficiary onboarding / settings
     │  │
     │  ├─ Card(padding="md" className="mb-3")          # My Templates
     │  │  ├─ div(flex justify-between items-center mb-2)
     │  │  │  ├─ h3(text-body-medium) → "My Templates"
     │  │  │  └─ Button(primary, sm) → "Publish New"    # → /publish/template
     │  │  └─ Table
     │  │     Header: Name | Status | Trust | Installs | Rating | Revenue
     │  │     Rows: one per published template
     │  │     Status: Published / Under Review / Rejected
     │  │     Actions: Edit | Unpublish
     │  │
     │  └─ Card(padding="md")                           # My Skills
     │     ├─ div(flex justify-between items-center mb-2)
     │     │  ├─ h3(text-body-medium) → "My Skills"
     │     │  └─ Button(primary, sm) → "Publish New"    # → /publish/skill
     │     └─ Table
     │        Header: Name | Status | Trust | Installs | Rating | Revenue
     │        Rows: one per published skill

ENROLLMENT FORM (modal or inline):
  ├─ Input(label="Display Name", required)
  ├─ Textarea(label="Bio")
  ├─ Input(label="Avatar URL" or AvatarUpload)
  ├─ Input(label="Twitter URL")
  ├─ Input(label="GitHub URL")
  ├─ Input(label="Website URL")
  ├─ Checkbox → "I agree to the Creator Terms"
  └─ Button(primary) → "Create Profile"
     → POST /api/creator/enroll

DATA SOURCE: GET /api/creator/profile, GET /api/creator/earnings, GET /api/creator/templates, GET /api/creator/skills
```

---

## SCREEN 18: /publish/template — Publish Template Flow

```
PageShell
  └─ div(max-w-2xl mx-auto px-4 py-4)
     ├─ WizardProgressBar([current:"Details", "Pricing", "Preview", "Submit"])
     │
     ├─ STEP 1: Details
     │  ├─ h2(text-title mb-2) → "Template Details"
     │  ├─ Input(label="Name", required, placeholder="e.g., Social Media Manager")
     │  │  # Validates: not conflicting with Official template names
     │  ├─ Input(label="Tagline", required, maxLength=100, placeholder="One sentence about what this Claw does")
     │  ├─ Textarea(label="Description", required, placeholder="Full description (markdown supported)")
     │  ├─ Select(label="Category") → Money-Making / Creator / Business Ops / Vertical / Lifestyle
     │  ├─ TagInput(label="Tags", max=5, placeholder="Add up to 5 tags")
     │  ├─ Input(label="Estimated Monthly LLM Cost", placeholder="e.g., $40-80", optional)
     │  └─ Button(primary) → "Next: Pricing →"
     │
     ├─ STEP 2: Pricing
     │  ├─ h2(text-title mb-2) → "Set Your Price"
     │  ├─ RadioGroup
     │  │  ├─ Radio → "Free" (description: "Anyone can install. You earn $0. Great for building reputation.")
     │  │  └─ Radio → "Paid" (description: "Set a price. You keep 100% minus ~3-5% processing.")
     │  ├─ IF paid:
     │  │  ├─ Input(type="number", label="Price (USD)", min=19, placeholder="49")
     │  │  ├─ p(text-micro text-content-tertiary) → "Minimum $19. You receive ~${price * 0.96} per sale."
     │  │  └─ p(text-micro text-content-tertiary) → "Payouts weekly, 7-day hold period."
     │  └─ Button(primary) → "Next: Preview →"
     │
     ├─ STEP 3: Preview
     │  ├─ h2(text-title mb-2) → "Preview Your Listing"
     │  ├─ Card(padding="md")                          # Preview card (how it'll look in marketplace)
     │  │  ├─ TrustBadge(tier="UNREVIEWED")
     │  │  ├─ Template name + tagline
     │  │  ├─ Agent pills (auto-generated from workspace snapshot)
     │  │  ├─ Tools required (auto-generated)
     │  │  ├─ Price display
     │  │  └─ CreatorCard(your profile)
     │  ├─ p(text-micro text-content-tertiary mt-2) → "Your template will be listed as 'Unreviewed' immediately. We'll review it for 'Verified' status."
     │  └─ Button(primary) → "Next: Submit →"
     │
     └─ STEP 4: Submit
        ├─ h2(text-title mb-2) → "Publish Your Template"
        ├─ Card(padding="md")
        │  ├─ Checklist (read-only confirmation)
        │  │  ├─ ✓ Name: {name}
        │  │  ├─ ✓ Category: {category}
        │  │  ├─ ✓ Price: ${price} (or Free)
        │  │  ├─ ✓ Agents: {count}
        │  │  └─ ✓ Skills referenced: {count} (all available ✓)
        │  └─ p(text-micro text-content-secondary) → "By publishing, you agree to the Creator Terms."
        ├─ Button(primary, lg) → "Publish Template"
        │  → POST /api/marketplace/templates
        └─ SUCCESS state:
           ├─ ✓ icon + "Template published!"
           ├─ p → "Listed as Unreviewed. We'll review it soon."
           └─ Button(outline) → "View in Marketplace" + Button(outline) → "Publish Another"

PRE-CHECK: User must be enrolled as creator. If not → redirect to enrollment form → return here after.
PRE-CHECK: User must have a Claw built in builder. The publish flow captures the current workspace snapshot.
           Entry point: Builder → "Publish" button (top right)
```

---

## SCREEN 19: /publish/skill — Publish Skill Flow

```
PageShell
  └─ div(max-w-2xl mx-auto px-4 py-4)
     ├─ WizardProgressBar([current:"Details", "SKILL.md", "Pricing", "Submit"])
     │
     ├─ STEP 1: Details
     │  ├─ h2(text-title mb-2) → "Skill Details"
     │  ├─ Input(label="Name", required)
     │  ├─ Input(label="Emoji", maxLength=2, placeholder="🔍")
     │  ├─ Textarea(label="Description", required, placeholder="When to use / not use this skill")
     │  ├─ Select(label="Category") → Communication / CRM / Data / Developer / Email / Finance / Marketing / Productivity / Search / Security / Social / System / Web
     │  ├─ TagInput(label="Tags", max=5)
     │  ├─ MultiInput(label="Required Binaries", placeholder="curl, jq, gh")
     │  ├─ MultiInput(label="Required Environment Variables", placeholder="API_KEY, SECRET")
     │  └─ Button(primary) → "Next: SKILL.md →"
     │
     ├─ STEP 2: SKILL.md Content
     │  ├─ h2(text-title mb-2) → "Skill Instructions"
     │  ├─ p(text-caption text-content-secondary mb-2) → "Write the SKILL.md content. This is what the agent sees and follows."
     │  ├─ div(grid grid-cols-2 gap-2 h-[400px])
     │  │  ├─ Textarea(monospace, full height) → SKILL.md markdown editor
     │  │  └─ div(border rounded overflow-auto p-3) → Live markdown preview
     │  ├─ p(text-micro text-content-tertiary mt-1) → "OR"
     │  ├─ FileUpload(accept=".md") → "Upload SKILL.md file"
     │  └─ Button(primary) → "Next: Pricing →"
     │
     ├─ STEP 3: Pricing
     │  ├─ (Same as template pricing step but minimum $5 for paid)
     │  └─ Button(primary) → "Next: Submit →"
     │
     └─ STEP 4: Submit
        ├─ h2(text-title mb-2) → "Publish Your Skill"
        ├─ Card(padding="md")
        │  ├─ Checklist
        │  │  ├─ ✓ Name: {name}
        │  │  ├─ ✓ Category: {category}
        │  │  ├─ ✓ Binaries: {requiredBins.join(", ")}
        │  │  ├─ ✓ Env vars: {requiredEnvVars.join(", ")}
        │  │  └─ ✓ Price: ${price} (or Free)
        │  └─ p(text-micro text-content-secondary) → "Your skill will be auto-scanned for security. If it passes, it'll be listed immediately."
        ├─ Button(primary, lg) → "Publish Skill"
        │  → POST /api/marketplace/skills
        │  → Layer 1 auto-scan runs synchronously
        └─ STATES:
           scan-passed:
             ├─ ✓ "Skill published! Auto-scan passed."
             └─ "Listed as Unreviewed. Sandbox test and manual review queued."
           scan-failed:
             ├─ ✗ "Auto-scan found issues"
             ├─ List of findings (severity + description + line number)
             └─ Button(outline) → "Fix and Resubmit"
```

---

## SCREEN 20: /admin/reviews — Admin Review Queue

```
PageShell
  └─ div(max-w-5xl mx-auto px-4 py-4)
     ├─ h1(text-display mb-3) → "Review Queue"
     │
     ├─ MarketplaceTabs(active="templates")            # Templates | Skills
     │
     ├─ Table
     │  Header: Name | Creator | Submitted | Trust Tier | Auto-Scan | Sandbox | Actions
     │  Rows: one per item with reviewStatus = PENDING
     │
     │  Name: clickable → opens detail in side panel
     │  Creator: CreatorCard compact (avatar + name)
     │  Submitted: relative time ("2 hours ago")
     │  Trust Tier: current TrustBadge
     │  Auto-Scan: ✓ Passed / ✗ Failed / ○ Pending
     │  Sandbox: ✓ Passed / ✗ Failed / ○ Pending / — N/A (templates)
     │  Actions:
     │     Button(primary, sm) → "Approve" → POST /api/admin/review-queue/{type}/{id}/approve
     │     Button(outline, sm) → "Reject"  → opens reject reason modal
     │     Button(outline, sm) → "View"    → opens full detail side panel
     │
     ├─ Reject Modal:
     │  ├─ h3 → "Reject {name}"
     │  ├─ Textarea(label="Reason", required, placeholder="Explain why this was rejected...")
     │  └─ Button(danger) → "Reject"
     │
     └─ Detail Side Panel (slides in from right):
        ├─ Full template/skill info
        ├─ SKILL.md preview (for skills)
        ├─ Auto-scan report (if available)
        ├─ Sandbox report (if available)
        └─ Approve / Reject buttons

DATA SOURCE: GET /api/admin/review-queue/templates, GET /api/admin/review-queue/skills
ACCESS: Admin users only (check in middleware)
```

---

## TOTAL COMPONENT COUNT

```
Primitives (Section 2):     15 components
Composites (Section 3):     16+ components
Marketplace components:     7 new (TrustBadge, CreatorCard, ReviewCard, ReviewStars, SkillCard, MarketplaceTabs, PriceDisplay)
Page compositions:          20 screens (14 original + 6 marketplace)
Modal compositions:         7 modals (5 original + install-to-workspace + reject-reason)
State variants:             25+ states
───────────────────────────
Total unique components:    ~65 files
Total screen compositions:  20 + 7 modals + 25 states = 52 specs

NEW ENTRY POINT — "Create New Claw":
  Location: /my-claws page + marketplace page header
  Button: "Create New Claw" (primary, sm) in top-right
  Action: POST /api/workspaces (creates empty workspace) → redirect to /builder/[newId]
  No template required. Builder opens blank. User adds agents from scratch.
  Deploy requires $79/mo subscription (3-day trial on first deploy).
```
