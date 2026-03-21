# Claws — Screen Composition Specs
## Every screen defined as a tree of named components with props
## Use with Claws_Design_System.md — components and pixel values are defined there

---

## How Cursor Uses This File

Each screen is a recipe: which components go where with what props. Build by assembling the named components.

**CRITICAL: When this file mentions abstract class names like `text-display` or `p-4`, IGNORE those values. Instead look up the component's pixel-exact spec in `docs/DESIGN_SYSTEM.md`.** The Design System Section 2 has exact pixel values for every component, and Section 3 has per-screen layout values. Those are the truth. This file defines STRUCTURE (what goes where). The Design System defines APPEARANCE (exact pixels).

Example: This file says `h1(text-display)`. The Design System Section 3 Screen 1 says the Store heading is `font-size 20px, font-weight 600`. Use `text-xl font-semibold`, NOT a custom `text-display` class.

---

## SCREEN 1: /store — Claw Catalog

```
PageShell(background="secondary")
  └─ div(max-w-5xl mx-auto px-4 py-4)
     ├─ div(text-center py-5)                         # Hero
     │  ├─ h1(text-display) → "AI agents that work while you sleep"
     │  ├─ p(text-body text-content-secondary mt-1 max-w-lg mx-auto) → subtitle
     │  ├─ Input(placeholder="Search Claws..." className="max-w-[280px] mx-auto mt-3")
     │  └─ div(flex gap-1.5 justify-center mt-2.5)    # Category tabs
     │     ├─ Button(primary, sm) → "All (20)"         # Active tab
     │     ├─ Button(outline, sm) → "Money-Making (3)"
     │     ├─ Button(outline, sm) → "Creator (4)"
     │     ├─ Button(outline, sm) → "Business Ops (4)"
     │     ├─ Button(outline, sm) → "Vertical (5)"
     │     └─ Button(outline, sm) → "Lifestyle (4)"
     │
     ├─ section                                        # Repeat per category
     │  ├─ CategoryBadge(category="MONEY_MAKING")
     │  ├─ p(text-micro text-content-secondary mb-2) → category description
     │  ├─ ClawCard(name="Quant Trader", price={setup:999,monthly:99}, agents=[...], ...)
     │  ├─ ClawCard(name="Freelancer Revenue Engine", ...)
     │  └─ ClawCard(name="E-Commerce Profit Maximizer", ...)
     │
     ├─ section                                        # Creator
     │  ├─ CategoryBadge(category="CREATOR")
     │  └─ ClawCard × 4 (YouTube, Twitter, Newsletter, Podcast)
     │
     ├─ section                                        # Business Ops
     │  ├─ CategoryBadge(category="BUSINESS_OPS")
     │  └─ ClawCard × 4 (B2B Sales, Agency, CoS, SEO)
     │
     ├─ section                                        # Vertical
     │  ├─ CategoryBadge(category="VERTICAL")
     │  └─ ClawCard × 5 (Real Estate, Recruiter, Medical, Law, Home Services)
     │
     └─ section                                        # Lifestyle
        ├─ CategoryBadge(category="LIFESTYLE")
        └─ ClawCard × 4 (Health, Student, Job, Dev)

STATE: search-no-results
  Replace category sections with:
    EmptyState(icon="🔍", title='No Claws match "{query}"', description="Try different keywords, or browse all categories.", actions=[Button(outline) "Clear search"])

DATA SOURCE: ClawTemplate model, grouped by category, sorted by sortOrder
```

---

## SCREEN 2: /store/[slug] — Claw Detail

```
PageShell(background="secondary")
  └─ div(max-w-4xl mx-auto px-4 py-4)
     ├─ PageHeader(breadcrumb="← Back to store")
     ├─ div(flex justify-between items-start mb-4)     # Title + Purchase
     │  ├─ div
     │  │  ├─ CategoryBadge(category)
     │  │  ├─ h1(text-display mt-2) → claw name
     │  │  └─ p(text-body text-content-secondary mt-1 max-w-xl leading-relaxed) → description
     │  └─ div(text-right)
     │     ├─ div(text-display text-brand) → "$499"
     │     ├─ div(text-micro text-content-secondary) → "one-time setup"
     │     ├─ div(text-title mt-1) → "+ $89/month"
     │     └─ Button(primary, lg, className="mt-3") → "Purchase this Claw"
     │
     ├─ Card(padding="md")                              # Hierarchy
     │  ├─ h3(text-title mb-2.5) → "Agent team hierarchy"
     │  └─ AgentHierarchy(orchestrator, workers[], critic)
     │
     ├─ div(grid grid-cols-2 gap-2.5 my-3)             # Tools
     │  ├─ Card(padding="md")
     │  │  ├─ h3(text-body-medium mb-2) → "Required tools"
     │  │  └─ list of required tools (name + "Connect during setup")
     │  └─ Card(padding="md")
     │     ├─ h3(text-body-medium mb-2) → "Recommended (swappable)"
     │     └─ list of recommended tools (name + alternatives + category label)
     │
     └─ div(flow box) → flow description text

STATE: already-purchased
  Replace purchase section with:
    StatusBadge(status="running") + "You own this Claw"
    Button(primary) → "Open Dashboard"
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
     ├─ h2(text-title mb-0.5) → "How should your Claw run?"
     ├─ p(text-caption text-content-secondary mb-3.5) → subtitle
     │
     ├─ div(grid grid-cols-2 gap-2.5 mb-4)             # Deploy options
     │  ├─ Card(selected=true, padding="md")            # Cloud (recommended)
     │  │  ├─ p(text-nano-medium text-brand mb-1) → "RECOMMENDED"
     │  │  ├─ h3(text-title text-brand) → "Cloud hosted"
     │  │  ├─ p(text-caption text-content-secondary) → "We run it. $12/month."
     │  │  ├─ p(text-nano text-status-success mt-1) → "Zero maintenance · Auto-updates · 99.9% uptime"
     │  │  └─ Button(primary, md, className="mt-2") → "Deploy to cloud"
     │  └─ Card(padding="md")                           # Self-hosted
     │     ├─ h3(text-title) → "Self-hosted"
     │     ├─ p(text-caption text-content-secondary) → "Download configs."
     │     ├─ p(text-nano text-content-secondary mt-1) → "Full control · No hosting fee"
     │     └─ Button(outline, md, className="mt-2") → "Download config package"
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
     │  └─ Tab("Security", active=false)
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
  ├─ div(grid grid-cols-3 gap-2 my-2.5) → StatCard × 3 (plan, active claws, this month)
  └─ div(flex gap-1.5) → Button(outline)"Manage subscription" + Button(outline)"View invoices"

TAB: Account
  Basic profile form: name, email, avatar

TAB: Security
  Connected OAuth providers, active sessions, 2FA (future)
```

---

## SCREEN 12: /pricing — Platform Plans

```
PageShell
  └─ div(max-w-4xl mx-auto px-4 py-6 text-center)
     ├─ h1(text-display mb-1) → "Simple, transparent pricing"
     ├─ p(text-body text-content-secondary mb-5) → subtitle
     │
     ├─ div(grid grid-cols-3 gap-3.5)                   # Plan cards
     │  ├─ PlanCard(name="Free", price="$0", period="forever", features=[{text:"1 workspace",included:true}, ...], ctaLabel="Get started free", ctaVariant="outline")
     │  ├─ PlanCard(name="Pro", price="$29", period="per month", featured=true, features=[...], ctaLabel="Upgrade to Pro", ctaVariant="primary")
     │  └─ PlanCard(name="Enterprise", price="$99", period="per month", features=[...], ctaLabel="Contact sales", ctaVariant="outline")
     │
     ├─ Card(padding="lg" className="text-left mt-5")   # Pricing explainer
     │  ├─ h3(text-body-medium mb-1.5) → "How pricing works"
     │  └─ p(text-caption text-content-secondary leading-loose) → 5-layer explanation
     │
     └─ p(text-caption text-content-secondary mt-3) → "7-day money-back guarantee"
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

## TOTAL COMPONENT COUNT

```
Primitives (Section 2):     15 components
Composites (Section 3):     16+ components
Page compositions:          14 screens
Modal compositions:         5 modals
State variants:             15+ states
───────────────────────────
Total unique components:    52 files (see Design System Section 7)
Total screen compositions:  14 + 5 modals + 15 states = 34 specs
```
