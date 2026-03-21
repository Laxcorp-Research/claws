# LaxClaws — Pixel-Level UI Specs (Extracted from HTML Mockups)

> **Source files:** `docs/LAXCLAWS_SCREENS.html` and `docs/LAXCLAWS_SCREENS_SUPPLEMENT.html`
>
> **Purpose:** This is the single source of truth for pixel-level implementation values.
> When building any screen or component, use these exact values. Do not guess.

---

## 1. CSS Variables (Color Tokens)

### Light Mode (default)
```
--bg:    #ffffff    → surface-primary     (white backgrounds, cards, modals)
--bg2:   #f9fafb    → surface-secondary   (page backgrounds, pill backgrounds, stat cards)
--bg3:   #f3f4f6    → surface-tertiary    (app body background, skeleton base)
--tx:    #111827    → content-primary     (headings, primary text)
--tx2:   #6b7280    → content-secondary   (body text, descriptions, nav inactive)
--tx3:   #9ca3af    → content-tertiary    (placeholder text, disabled, timestamps)
--bd:    #e5e7eb    → border-default      (card borders, dividers, input borders)
--bd2:   #d1d5db    → border-strong       (heavy dividers)
--ac:    #3b82f6    → brand               (links, active states, primary buttons)
--acbg:  #eff6ff    → brand-light         (orchestrator bg, active tab bg, info bg)
--ok:    #10b981    → status-success      (connected dots, positive trends)
--okbg:  #dcfce7    → status-success-bg   (running badge bg, success banner)
--warn:  #f59e0b    → status-warning      (paused, pending review)
--warnbg:#fef3c7    → status-warning-bg   (warning banner, legal disclaimers)
--err:   #ef4444    → status-error        (error states, danger buttons)
--errbg: #fee2e2    → status-error-bg     (error banner, error badges)
```

### Dark Mode
```
--bg:    #18181b    → surface-primary
--bg2:   #1f1f23    → surface-secondary
--bg3:   #27272a    → surface-tertiary
--tx:    #e5e7eb    → content-primary
--tx2:   #9ca3af    → content-secondary
--tx3:   #6b7280    → content-tertiary
--bd:    #3f3f46    → border-default
--bd2:   #52525b    → border-strong
--ac:    #60a5fa    → brand
--acbg:  #1e293b    → brand-light
--ok:    #34d399    → status-success
--okbg:  #064e3b    → status-success-bg
--warn:  #fbbf24    → status-warning
--warnbg:#451a03    → status-warning-bg
--err:   #f87171    → status-error
--errbg: #450a0a    → status-error-bg
```

### Category Badge Colors
```
MONEY_MAKING:  bg #fef3c7, text #92400e
CREATOR:       bg #dcfce7, text #166534
BUSINESS_OPS:  bg #dbeafe, text #1e40af
VERTICAL:      bg #ede9fe, text #5b21b6
LIFESTYLE:     bg #fce7f3, text #9d174d
```

### Agent Colors
```
Orchestrator:  #3b82f6
Worker 1:      #10b981 (green)
Worker 2:      #3b82f6 (blue)
Worker 3:      #8b5cf6 (purple)
Worker 4:      #f59e0b (amber)
Worker 5:      #ef4444 (red)
Worker 6:      #06b6d4 (cyan)
Critic:        #8b5cf6 (purple — same as worker3)
```

### Border Radii
```
--r:   8px    → standard (buttons, inputs, cards, badges, stat cards)
--rl:  12px   → large (screen containers, claw cards, tool lists, workspace cards, modals)
```

---

## 2. Global Base Styles

```
body:
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif
  font-size: 13px
  line-height: 1.5
  background: var(--bg3)     → surface-tertiary
  color: var(--tx)           → content-primary
```

---

## 3. Shared Components (Exact Pixel Specs)

### 3.1 TopBar (.top)

```
Container:
  display: flex
  align-items: center
  justify-content: space-between
  padding: 10px 16px
  border-bottom: 1px solid var(--bd)
  background: var(--bg2)         → surface-secondary

Logo (.logo):
  font-weight: 600
  font-size: 15px
  "Lax" = content-primary color
  "Claws" = var(--ac) brand color

Navigation (.nav):
  display: flex
  gap: 16px
  font-size: 12px
  Inactive links: color var(--tx2), no decoration
  Active link: color var(--ac), font-weight 500

Right section (logged out):
  Button "Sign in" (primary)

Right section (logged in):
  Avatar circle: width 28px, height 28px, border-radius 50%
  background var(--ac), color #fff
  font-size 11px, font-weight 600
```

### 3.2 Buttons (.btn)

```
Base (.btn):
  font-size: 11px
  padding: 5px 14px
  border-radius: 8px (var(--r))
  border: none
  cursor: pointer
  font-weight: 500
  display: inline-block

Primary (.bp):
  background: var(--ac) → #3b82f6
  color: #fff

Outline (.bo):
  background: transparent
  border: 1px solid var(--bd)
  color: var(--tx2)

Danger (.bd):
  background: var(--err) → #ef4444
  color: #fff

Context-specific overrides used in mockups:
  Category filters:   font-size 10px, padding 4px 12px
  Tool row buttons:   font-size 10px, padding 3px 10px
  Tiny action btns:   font-size 9px, padding 2px 6px or 2px 8px
  Wizard Next/CTA:    padding 8px 24px
  CTA large:          padding 8px 28px or 10px 24px, font-size 13px
  Full-width CTA:     width 100%, padding 10px
```

### 3.3 Category Badge (.cat-l)

```
font-size: 11px
font-weight: 600
letter-spacing: 0.5px
text-transform: uppercase
padding: 3px 12px
border-radius: 8px (var(--r))
display: inline-block
margin-bottom: 6px

Per-category colors: see "Category Badge Colors" above
```

### 3.4 ClawCard (.claw)

```
Container:
  background: var(--bg) → surface-primary
  border: 1px solid var(--bd)
  border-radius: 12px (var(--rl))
  padding: 14px 18px
  margin-bottom: 10px
  NO shadow

Header (.claw-h):
  display: flex
  justify-content: space-between
  align-items: flex-start
  margin-bottom: 4px

Name (.claw-n):
  font-size: 15px
  font-weight: 600

Price (.claw-p):
  font-size: 13px
  font-weight: 600
  color: var(--ac) → brand
  white-space: nowrap
  Format: "$999 + $99/mo"

Description (.claw-d):
  font-size: 12px
  color: var(--tx2)
  line-height: 1.5
  margin-bottom: 10px
```

### 3.5 Agent Pill (.pill)

```
font-size: 10px
padding: 3px 10px
border-radius: 16px
border: 1px solid var(--bd)
color: var(--tx2)
background: var(--bg2) → surface-secondary
display: inline-flex
align-items: center
gap: 4px

Critic pill override:
  border-color: #8b5cf6
  color: #5b21b6

Pill container (.pills):
  display: flex
  flex-wrap: wrap
  gap: 5px
  margin-bottom: 8px

Dot (.pdot):
  width: 6px
  height: 6px
  border-radius: 50%
  flex-shrink: 0
  color: set via inline style per agent
```

### 3.6 Flow Description (.flow)

```
font-size: 11px
color: var(--tx2) → content-secondary
font-style: italic
line-height: 1.5
padding: 8px 12px
background: var(--bg2) → surface-secondary
border-radius: 8px (var(--r))
border-left: 3px solid var(--bd)
```

### 3.7 Legal Disclaimer (.legal)

```
font-size: 10px
color: #92400e
background: #fef3c7
padding: 6px 12px
border-radius: 8px (var(--r))
margin-top: 8px
border-left: 3px solid var(--warn) → #f59e0b
```

### 3.8 Status Badge (.ws-badge)

```
font-size: 10px
padding: 2px 8px
border-radius: 12px
font-weight: 500

Running:   bg var(--okbg) #dcfce7, color var(--ok) #10b981
Paused:    bg var(--warnbg) #fef3c7, color var(--warn) #f59e0b
Error:     bg var(--errbg) #fee2e2, color var(--err) #ef4444
Draft:     bg var(--bg3) #f3f4f6, color var(--tx3) #9ca3af
Setup:     bg var(--acbg) #eff6ff, color var(--ac) #3b82f6
```

### 3.9 Tool Row (.tool-row)

```
Container (.tool-list):
  border: 1px solid var(--bd)
  border-radius: 12px (var(--rl))
  margin-bottom: 14px

Row (.tool-row):
  display: flex
  align-items: center
  justify-content: space-between
  padding: 12px 14px
  border-bottom: 1px solid var(--bd)
  Last child: no border-bottom

Tool info (.tool-info):
  display: flex
  align-items: center
  gap: 8px

Status dot (.tool-dot):
  width: 9px
  height: 9px
  border-radius: 50%
  Connected (.tool-ok): background var(--ok)
  Disconnected (.tool-no): border 2px solid var(--bd), background transparent

Tool name (.tool-name):
  font-size: 12px
  font-weight: 600

Tool description (.tool-desc):
  font-size: 10px
  color: var(--tx2)

Tool status badge (.tool-status):
  font-size: 10px
  font-weight: 500
  padding: 2px 8px
  border-radius: 12px
  OK: color var(--ok), bg var(--okbg)
  Error: color var(--err), bg var(--errbg)
```

### 3.10 Stat Card (.stat)

```
Container (.stat-grid):
  display: grid
  grid-template-columns: repeat(4, 1fr)
  gap: 8px
  margin-bottom: 14px

Card (.stat):
  background: var(--bg2) → surface-secondary
  border-radius: 8px (var(--r))
  padding: 12px

Label (.stat-l):   font-size 10px, color var(--tx2)
Value (.stat-v):   font-size 18px, font-weight 600, margin-top 2px
Trend (.stat-d):   font-size 10px, color var(--ok), margin-top 1px
Alert value:       color var(--warn) instead of default
```

### 3.11 Activity Log (.log)

```
Container (.activity):
  border: 1px solid var(--bd)
  border-radius: 8px (var(--r))
  padding: 12px

Title: font-size 13px, font-weight 600, margin-bottom 8px

Row (.log):
  display: flex
  gap: 8px
  padding: 5px 0
  border-bottom: 1px solid var(--bd)
  font-size: 11px
  Last child: no border

Timestamp (.log-t):
  color: var(--tx3)
  min-width: 40px
  font-family: monospace
  font-size: 10px

Agent name (.log-a):
  font-weight: 600
  min-width: 56px
  color: agent-specific color

Message (.log-m):
  color: var(--tx2)
  flex: 1
```

### 3.12 Agent Hierarchy (.hier)

```
Container:
  display: flex
  flex-direction: column
  align-items: center
  gap: 6px
  margin: 12px 0

Orchestrator (.hier-orch):
  background: var(--acbg) → brand-light
  border: 2px solid var(--ac) → brand
  border-radius: 8px
  padding: 8px 18px
  text-align: center
  min-width: 180px
  Label: font-size 9px, color var(--ac), font-weight 600, uppercase, letter-spacing 0.5px
  Name:  font-size 13px, font-weight 600
  Desc:  font-size 10px, color var(--tx2)

Arrow (.hier-arrow):
  color: var(--tx3)
  font-size: 11px

Workers container (.hier-workers):
  display: flex
  gap: 6px
  flex-wrap: wrap
  justify-content: center

Worker card (.hier-w):
  border: 1px solid var(--bd)
  border-radius: 8px
  padding: 6px 12px
  text-align: center
  min-width: 100px
  border-left: 3px solid [agent-color] (inline style)
  Name: font-size 11px, font-weight 600
  Desc:  font-size 9px, color var(--tx2)

Critic (.hier-critic):
  background: #ede9fe
  border: 2px solid #8b5cf6
  border-radius: 8px
  padding: 8px 18px
  text-align: center
  min-width: 180px
  Label: font-size 9px, color #5b21b6, font-weight 600, uppercase, letter-spacing 0.5px
  Name:  font-size 13px, font-weight 600, color #5b21b6
  Desc:  font-size 10px, color #7c3aed
```

### 3.13 Wizard Progress Bar (.steps)

```
Container:
  display: flex
  align-items: center
  justify-content: center
  margin-bottom: 20px
  flex-wrap: wrap

Step dot (.step-dot):
  width: 26px
  height: 26px
  border-radius: 50%
  display: flex, align-items center, justify-content center
  font-size: 11px
  font-weight: 600
  Done (.step-done):   bg var(--ok), color #fff, content "✓"
  Current (.step-cur): bg var(--ac), color #fff, content [number]
  Upcoming (.step-todo): border 1px solid var(--bd), color var(--tx3)

Step line (.step-line):
  width: 30px
  height: 1px
  margin: 0 3px
  Done: bg var(--ok)
  Todo: bg var(--bd)

Step label (.step-label):
  font-size: 10px
  margin-left: 4px
  margin-right: 8px
  Active (.step-label-on): color var(--ac), font-weight 500
  Inactive (.step-label-off): color var(--tx3)
```

### 3.14 Modal

```
Overlay:
  background: rgba(0,0,0,0.3)

Box (.modal-box):
  background: var(--bg) → surface-primary
  border: 1px solid var(--bd)
  border-radius: 12px (var(--rl))
  padding: 20px
  max-width: 480px (standard), 560px (large/browse), 360px (confirm)
  margin: 0 auto
  box-shadow: 0 8px 30px rgba(0,0,0,0.12)

Title (.modal-title):   font-size 15px, font-weight 600, margin-bottom 4px
Desc (.modal-desc):     font-size 12px, color var(--tx2), margin-bottom 14px

Form label:
  font-size: 11px
  font-weight: 500
  display: block
  margin-bottom: 3px-4px

Form input:
  width: 100%
  padding: 8px 10px
  border: 1px solid var(--bd)
  border-radius: 6px
  font-size: 12px
  Monospace inputs: font-family monospace

Footer buttons:
  display flex, gap 6px, justify-content flex-end
```

### 3.15 Error Banner (.err-banner)

```
background: var(--errbg) → #fee2e2
border: 1px solid var(--err) → #ef4444
border-radius: 8px
padding: 12px 14px
margin-bottom: 14px
display: flex
align-items: flex-start
gap: 8px

Icon (.err-icon): color var(--err), font-size 16px, flex-shrink 0
Text (.err-text):  font-size 12px, color #991b1b
Bold:              font-weight 600
```

### 3.16 Warning Banner (.warn-banner)

```
background: var(--warnbg) → #fef3c7
border: 1px solid var(--warn) → #f59e0b
border-radius: 8px
padding: 12px 14px
margin-bottom: 14px
display: flex
align-items: flex-start
gap: 8px

Icon (.warn-icon): color var(--warn), font-size 16px, flex-shrink 0
Text (.warn-text):  font-size 12px, color #92400e
```

### 3.17 Tabs (.tabs)

```
Container:
  display: flex
  gap: 0
  border-bottom: 1px solid var(--bd)
  margin-bottom: 14px

Tab (.tab):
  padding: 6px 14px
  font-size: 12px
  color: var(--tx2)
  cursor: pointer
  border-bottom: 2px solid transparent

Active (.tab.on):
  color: var(--ac)
  border-bottom-color: var(--ac)
  font-weight: 500
```

### 3.18 Skeleton Loading (.skel)

```
background: linear-gradient(90deg, var(--bg3) 25%, var(--bd) 50%, var(--bg3) 75%)
border-radius: 8px
animation: shimmer 1.5s infinite

Card skeleton:  height 100px, border-radius 12px, margin-bottom 10px
Line skeleton:  height 14px, margin-bottom 8px, width 80%
Short line:     height 14px, margin-bottom 8px, width 40%
```

### 3.19 Empty State (.empty)

```
text-align: center
padding: 40px 20px
color: var(--tx2)

Title: font-size 16px, font-weight 600, color var(--tx), margin-bottom 6px
Body:  font-size 13px, margin-bottom 14px
```

### 3.20 Input Fields

```
Standard input:
  padding: 8px 14px (search) or 8px 10px (form) or 5px 8px (compact/builder)
  border: 1px solid var(--bd)
  border-radius: 8px (search) or 6px (form/compact)
  font-size: 12px (search/form) or 11px (compact)

Monospace input: add font-family monospace
Textarea: same + height 58px, resize none, font-size 10px

Auth input:
  padding: 10px 12px
  border: 1px solid var(--bd)
  border-radius: 8px
  font-size: 13px
  margin-bottom: 8px
```

---

## 4. Per-Screen Layout Specs

### Screen 1: Store (/store)

```
Route: /store
Background: var(--bg2) → surface-secondary
Body padding: 16px

Hero section:
  text-align: center
  padding: 20px 0 16px (supplement) or 16px 0 12px (original)
  Heading: font-size 20px (supplement) or 18px (original), font-weight 600
  Subtitle: font-size 13px (supplement) or 12px (original), color var(--tx2), margin-top 4px
           max-width 500px, centered
  Search input: margin-top 12px, width 280px, padding 8px 14px, font-size 12px, border-radius 8px
  Category filters: margin-top 10px, flex, gap 6px, centered, wrap
    Active: btn bp, font-size 10px, padding 4px 12px
    Inactive: btn bo, font-size 10px, padding 4px 12px

Category section:
  Category badge: .cat-l (see 3.3)
  Category description: font-size 11px (supplement) or 12px (original), color var(--tx2), margin-bottom 8-12px
  Cards: stacked vertically, gap 10px (margin-bottom on each card)

Card numbers: "1. Quant Trader" format in .claw-n
Cards show: Workers + Critic as pills. Orchestrator mentioned in flow only.
```

### Screen 2: Claw Detail (/store/[slug])

```
Route: /store/[slug]
Background: var(--bg2)
Body padding: 16px

Breadcrumb:
  font-size: 11px
  color: var(--tx2)
  margin-bottom: 10px
  cursor: pointer
  Text: "← Back to store"

Title section:
  display: flex, justify-content space-between, align-items flex-start
  margin-bottom: 14px

  Left:
    Category badge (.cat-l)
    Name: font-size 22px, font-weight 600, margin-top 6px
    Description: font-size 13px, color var(--tx2), margin-top 4px, max-width 520px, line-height 1.6

  Right (pricing):
    Price: font-size 26px, font-weight 600, color var(--ac)
    Label: font-size 11px, color var(--tx2)
    Monthly: font-size 14px, font-weight 500, margin-top 2px
    CTA button: margin-top 10px, padding 8px 28px, font-size 13px

Hierarchy card:
  border: 1px solid var(--bd), border-radius 12px, padding 14px, margin-bottom 14px
  Title: font-size 13px, font-weight 600, margin-bottom 10px
  Content: .hier component (see 3.12)

Tools grid:
  display: grid, grid-template-columns 1fr 1fr, gap 10px, margin-bottom 14px
  Each card: border 1px solid var(--bd), border-radius 12px, padding 14px
  Title: font-size 13px, font-weight 600, margin-bottom 8px
  Items: font-size 12px, flex column, gap 4px
  Required tool annotation: font-size 10px, color var(--ok)
  Recommended alternatives: font-size 9px, color var(--tx3)

Flow box: .flow component (see 3.6)
```

### Screen 3: My Claws (/my-claws)

```
Route: /my-claws
Background: var(--bg) → surface-primary
Body padding: 16px

Header:
  display: flex, justify-content space-between, align-items center, margin-bottom 14px
  Title: font-size 16px, font-weight 600
  Actions: flex, gap 6px → "Browse store" (outline) + "+ Create custom Claw" (primary)

Workspace grid (.cgrid):
  display: grid
  grid-template-columns: repeat(3, 1fr)
  gap: 10px
  margin-bottom: 14px

Workspace card (.ws-card):
  border: 1px solid var(--bd)
  border-radius: 12px
  padding: 14px
  cursor: pointer
  transition: border-color 0.15s
  Hover: border-color var(--ac)

  Header: flex, space-between, align-items flex-start, margin-bottom 6px
  Name (.ws-name): font-size 14px, font-weight 600
  Badge (.ws-badge): see 3.8
  Meta line: font-size 11px, color var(--tx2)
  Meta row (.ws-meta): flex, gap 14px, font-size 11px, color var(--tx2), margin-top 4px

Empty state:
  border: 1px dashed var(--bd), border-radius 12px, padding 20px
  .empty component (see 3.19)

Loading state:
  3x skeleton cards in grid, height 100px
```

### Screen 4: Setup Step 1 — AI Models

```
Route: /setup/[workspaceId]/step/1
Progress bar: .steps (see 3.13), step 1 current
Body padding: 16px

Title: font-size 15px, font-weight 600, margin-bottom 4px
Subtitle: font-size 12px, color var(--tx2), margin-bottom 14px

API key card:
  border 1px solid var(--bd), border-radius 12px, padding 14px, margin-bottom 14px
  Title: font-size 13px, font-weight 600, margin-bottom 6px
  Input row: flex, gap 8px, items center
    Input: .prop-in (padding 5px 8px, border-radius 6px, font-size 11px), flex 1
    Button: .btn.bp "Validate"
  Help link: font-size 10px, color var(--tx2), margin-top 4px

Model table (.mtable):
  width 100%, border-collapse collapse, font-size 12px, margin-bottom 14px
  Header: font-size 11px, font-weight 600, color var(--tx2), padding 6px 8px
  Cells: padding 6px 8px, border-bottom 1px solid var(--bd)
  Agent name: font-weight 600
  Role text: font-size 10px
    Orchestrator: color var(--ac)
    Worker: color var(--tx2)
    Critic: color #5b21b6
  Select: padding 3px 6px, border-radius 6px, font-size 11px

Recommendation box:
  background var(--bg2), border-radius 8px, padding 10px
  font-size 11px, color var(--tx2), margin-bottom 14px

Next button: align right, padding 8px 24px

Error state:
  Card border changes to var(--err), background var(--errbg)
  Title: font-size 13px, font-weight 600, color #991b1b
  Input border: 1px solid var(--err)
  Error text: font-size 11px, color #991b1b
```

### Screen 5: Setup Step 2 — Connect Tools

```
Route: /setup/[workspaceId]/step/2
Progress bar: step 1 done, step 2 current

Section titles: font-size 14px, font-weight 600, margin-bottom 2px
Section subtitles: font-size 11px, color var(--tx2), margin-bottom 10px

Required tools: .tool-list (see 3.9)
Recommended tools: .tool-list with Swap buttons

Swap modal (.swap):
  border 1px solid var(--ac), border-radius 12px, padding 14px
  background var(--acbg), margin-bottom 14px
  Title: font-size 12px, font-weight 600, color var(--ac), margin-bottom 6px
  Options: flex, gap 6px, wrap
  Option: border 1px solid var(--bd), border-radius 8px, padding 6px 12px, bg var(--bg), font-size 11px

Extra actions: flex, gap 8px, margin-bottom 14px
  Each: btn bo, flex 1, padding 8px

Footer: flex, space-between
  Left: "← Back" outline
  Right: flex gap 6px → "Skip optional" outline + "Next: Deploy →" primary (padding 8px 24px)
```

### Screen 6: Setup Step 3 — Deploy

```
Route: /setup/[workspaceId]/step/3
Progress bar: steps 1-2 done, step 3 current

Title: font-size 15px, font-weight 600, margin-bottom 4px
Subtitle: font-size 12px, color var(--tx2), margin-bottom 14px

Deploy grid (.deploy-grid):
  display grid, grid-template-columns 1fr 1fr, gap 10px

Deploy card (.dcard):
  border 1px solid var(--bd), border-radius 8px, padding 14px, text-align center
  Featured (.dfeat): border 2px solid var(--ac)
  Recommended label: font-size 10px, color var(--ac), font-weight 600, margin-bottom 4px
  Title: font-size 13px, font-weight 600, margin-bottom 3px
  Body: font-size 11px, color var(--tx2)
  Features: font-size 10px, color var(--ok) or var(--tx2), margin-top 4px
  Button: margin-top 8px

Progress panel (.prog):
  border 1px solid var(--bd), border-radius 12px, padding 14px
  Title: font-size 13px, font-weight 600, margin-bottom 8px
  Item: flex, gap 8px, padding 4px 0, font-size 12px
  Icon: width 18px, text-align center
    Done: color var(--ok), "✓"
    Current: color var(--ac), "●"
    Waiting: color var(--tx3), "○"
    Failed: color var(--err), "✗"

Failure state:
  Last progress item shows ✗ in error color + bold label
  Error banner below (.err-banner)
  Action buttons: flex gap 6px → Retry (primary), Check tools (outline), View logs (outline)
```

### Screen 7: Setup Step 4 — Channels

```
Route: /setup/[workspaceId]/step/4
Progress bar: steps 1-3 done, step 4 current

Title: font-size 15px, font-weight 600, margin-bottom 4px
Subtitle: font-size 12px, color var(--tx2), margin-bottom 14px

Channel list: .tool-list format
  Web chat: always connected (.tool-ok)
  Others: disconnected (.tool-no) with Connect button (font-size 10px, padding 3px 10px)

Footer: flex, space-between, margin-top 14px
```

### Screen 8: Setup Step 5 — Go Live

```
Route: /setup/[workspaceId]/step/5
Progress bar: all steps done, final dot green

Celebration (.celebrate):
  text-align center, padding 30px 20px
  Emoji: font-size 32px, margin-bottom 8px
  Title: font-size 20px, font-weight 600, margin-bottom 6px
  Subtitle: font-size 13px, color var(--tx2), margin-bottom 4px, line-height 1.6

Tips box (.tips):
  text-align left, max-width 500px, margin 16px auto
  background var(--bg2), border-radius 8px, padding 14px
  font-size 12px, color var(--tx2), line-height 1.8

CTA buttons: margin-top 16px, flex, gap 8px, centered
  Primary: padding 10px 24px, font-size 13px
  Outline: padding 10px 24px, font-size 13px
```

### Screen 9: Visual Agent Builder

```
Route: /builder/[workspaceId]
TopBar right: flex gap 6px → Manage Tools, Dashboard, Test Run (outline, font-size 10px) + Deploy (primary, font-size 10px)
Body padding: 10px

Layout (.blayout):
  display: grid
  grid-template-columns: 190px 1fr 190px
  gap: 10px
  min-height: 340px

Left panel (.bpanel):
  border 1px solid var(--bd), border-radius 8px, padding 10px, font-size 11px
  Section title: font-size 10px, font-weight 600, color var(--tx2), uppercase, letter-spacing 0.5px, margin-bottom 8px
  List item (.bitem): flex, gap 6px, padding 6px 8px, border-radius 6px, margin-bottom 3px, font-size 11px
    Hover: bg var(--bg2)
    Active (.on): bg var(--acbg), color var(--ac)
    Orchestrator: bg var(--acbg), border-left 3px solid var(--ac), bold
    Critic: border-left 3px solid #8b5cf6, bold
  Add worker button: btn bo, width 100%, margin-top 8px, font-size 10px

Canvas (.bcanvas):
  background: var(--bg2)
  border: 1px dashed var(--bd)
  border-radius: 8px
  padding: 14px
  position: relative
  min-height: 340px

Agent node (.bnode):
  background var(--bg), border 1px solid var(--bd), border-radius 8px
  padding 10px 12px, position absolute, width 130px
  box-shadow: 0 1px 2px rgba(0,0,0,0.04)
  Title: font-size 11px, font-weight 600, margin-bottom 2px
  Desc: font-size 9px, color var(--tx2)
  Status dot: width 6px, height 6px, border-radius 50%, bg var(--ok), position absolute top 7px right 7px
  Orchestrator node: width 160px, border 2px solid var(--ac), bg var(--acbg)
  Critic node: width 160px, border 2px solid #8b5cf6, bg #ede9fe

Right panel (properties):
  Same as left panel (.bpanel)
  Property group (.prop-g): margin-bottom 10px
  Label: font-size 10px, color var(--tx2), margin-bottom 3px, font-weight 500
  Input (.prop-in): padding 5px 8px, border-radius 6px, font-size 11px
  Textarea (.prop-ta): same + height 58px, resize none, font-size 10px, font-family monospace
  Select: same as .prop-in but font-size 10px

Heartbeat bar (bottom of canvas):
  position absolute, bottom 8px, left 6px, right 6px
  background var(--bg), border 1px solid var(--bd), border-radius 6px
  padding 6px 10px, font-size 10px

Empty state (new custom Claw):
  centered, min-height 250px, bg var(--bg2)
  Emoji: font-size 40px, margin-bottom 8px
  Title: font-size 16px, font-weight 600, margin-bottom 4px
  Desc: font-size 12px, color var(--tx2), margin-bottom 14px
  CTA: padding 10px 20px, font-size 13px
  Footnote: font-size 11px, color var(--tx3), margin-top 10px
```

### Screen 10: Live Dashboard

```
Route: /dashboard/[workspaceId]
TopBar right: flex gap 6px → Edit in Builder, Manage Tools, Pause (outline, font-size 10px)
Body padding: 16px

Header: flex, space-between, align-items center, margin-bottom 12px
  Name: font-size 16px, font-weight 600
  Status badge: inline, margin-left 6px

Stat grid: .stat-grid (see 3.10)

Pending approvals:
  border 1px solid var(--warn), border-radius 8px, padding 12px, margin-bottom 14px
  background var(--warnbg)
  Title: font-size 12px, font-weight 600, color #92400e, margin-bottom 6px
  Items: font-size 11px, flex column, gap 6px
  Item: flex, space-between, align-items center, bg var(--bg), padding 8px 10px, border-radius 6px
  Action buttons: font-size 9px, padding 2px 8px

Activity feed: .activity component (see 3.11)

Paused state:
  Warning banner (.warn-banner) with Resume button
  Stats at opacity 0.5

Error state:
  Error banner (.err-banner) with Force restart (danger), View logs, Check tools

Dashboard enhancements:
  Cost breakdown: border 1px solid var(--bd), border-radius 12px, padding 14px
    Header: flex space-between → title (13px 600) + total (16px 600 brand)
    Table: font-size 12px, rows with border-bottom
    Tip box: font-size 11px, bg var(--bg2), border-radius 6px, padding 8px

  Agent status list: border 1px solid var(--bd), border-radius 12px, padding 14px
    Title: font-size 13px, font-weight 600, margin-bottom 10px
    Rows: flex, gap 6px
    Row: flex, space-between, padding 8px 10px, border-radius 6px
      Normal: bg var(--bg2)
      Paused: bg var(--warnbg)
      Error: bg var(--errbg)
    Status dot: 8px × 8px
    Name: font-size 12px, font-weight 600
    Meta: font-size 10px, color var(--tx2)
    Critic name: color #5b21b6
    Note: font-size 10px, color var(--tx3), margin-top 8px
```

### Screen 11: Settings

```
Route: /settings
Tabs: .tabs component (see 3.17)
  Tabs: Account, API Keys, Billing, Security
Body padding: 16px

API Keys tab:
  Title: font-size 14px, font-weight 600, margin-bottom 2px
  Subtitle: font-size 11px, color var(--tx2), margin-bottom 12px
  Keys list: .tool-list format
  Valid indicator: font-size 10px, color var(--ok)
  Action buttons: font-size 9px, padding 2px 6px
  Remove button: color var(--err)

Billing tab:
  Title: font-size 14px, font-weight 600, margin-bottom 2px
  Stat grid: 3 columns (not 4), gap 8px
  Stat value: font-size 15px (not 18px)
  Actions: flex gap 6px → Manage subscription + View invoices (outline)
```

### Screen 12: Pricing

```
Route: /pricing
Background: var(--bg) → surface-primary
Body padding: 16px, text-align center

Title: font-size 20px, font-weight 600, margin-bottom 4px
Subtitle: font-size 13px, color var(--tx2), margin-bottom 20px

Plan grid (.plan-grid):
  display grid, grid-template-columns repeat(3, 1fr), gap 14px, margin-bottom 14px

Plan card (.plan):
  border 1px solid var(--bd), border-radius 12px, padding 20px, text-align center
  Featured (.plan-feat): border 2px solid var(--ac)
  Featured label: font-size 10px, color var(--ac), font-weight 600, margin-bottom 4px
  Name (.plan-name): font-size 18px, font-weight 600, margin-bottom 4px
  Price (.plan-price): font-size 28px, font-weight 600, color var(--ac)
  Period (.plan-period): font-size 12px, color var(--tx2)
  Features (.plan-features): text-align left, font-size 12px, margin 14px 0, line-height 2.0
    Check: color var(--ok)
    Cross: color var(--tx3)
  CTA button: width 100%, padding 10px

Pricing explainer:
  border 1px solid var(--bd), border-radius 12px, padding 14px, text-align left
  Title: font-size 13px, font-weight 600, margin-bottom 6px
  Body: font-size 12px, color var(--tx2), line-height 1.8

Footer: font-size 12px, color var(--tx2), margin-top (after explainer)
```

### Screen 13: Auth (Sign In)

```
Route: /auth/signin
TopBar nav (logged out): Store, Pricing, Docs — no Sign in button

Auth box (.auth-box):
  max-width 400px, margin 30px auto, text-align center
  Title: font-size 20px, font-weight 600, margin-bottom 4px
  Subtitle: font-size 13px, color var(--tx2), margin-bottom 20px

OAuth button (.auth-btn):
  flex, center, gap 8px, width 100%, padding 10px
  border 1px solid var(--bd), border-radius 8px
  margin-bottom 8px, font-size 13px
  background var(--bg)
  Hover: bg var(--bg2)
  Icon: width 18px, height 18px

Divider (.auth-divider):
  flex, center, margin 14px 0, font-size 11px, color var(--tx3)
  Lines: flex 1, height 1px, bg var(--bd)
  Text: margin 0 10px

Email input (.auth-input):
  width 100%, padding 10px 12px
  border 1px solid var(--bd), border-radius 8px
  font-size 13px, margin-bottom 8px

Magic link button: width 100%, padding 10px, font-size 13px

Footer: font-size 11px, color var(--tx3), margin-top 14px

Error state:
  .err-banner between title and OAuth buttons
```

### Screen 14: Onboarding

```
Route: /onboarding
Body padding: 16px

Container: max-width 560px, margin 20px auto, text-align center
Title: font-size 24px, font-weight 600, margin-bottom 6px
Subtitle: font-size 14px, color var(--tx2), margin-bottom 24px

Step card:
  border 1px solid var(--bd), border-radius 12px, padding 16px
  text-align left, margin-bottom 12px

  Header: flex, gap 10px, align-items center, margin-bottom 8px
  Number circle: width 28px, height 28px, border-radius 50%
    Active: bg var(--ac), color #fff, font-size 12px, font-weight 600
    Disabled: border 1px solid var(--bd), color var(--tx3), font-size 12px
  Title: font-size 14px, font-weight 600
  Desc: font-size 11px, color var(--tx2)
  Disabled step: opacity 0.5

  Actions: flex, gap 6px, margin-left 38px
  Buttons: font-size 11px

Skip link: font-size 11px, color var(--ac), margin-top 16px
```

---

## 5. Modals (Exact Specs)

### API Key Modal
```
Size: max-width 480px
Title: "Connect {toolName}"
Description mentions AES-256-GCM encryption
Input: monospace, font-size 12px, padding 8px 10px, border-radius 6px
Help link: font-size 11px, color var(--ac)
Validation states: 11px — success (ok color), error (err color), validating (warn color + spinner)
Footer: Cancel (outline) + Validate & save (primary)
```

### Browse Tools Modal
```
Size: max-width 560px
Title: "Browse tools"
Search: same as modal input, margin-bottom 12px
Category filters: flex wrap, gap 6px, btn bo, font-size 10px, padding 3px 8px
Tool list: .tool-list format with Connect buttons (font-size 10px, padding 3px 10px)
Footer count: font-size 11px, color var(--tx3), centered
Close: align right
```

### Custom API Modal
```
Size: max-width 480px
Title: "Connect a custom API"
Fields: Tool name, Base URL (monospace), Auth type (select), API Key (password, monospace), Description (textarea 60px)
All labels: font-size 11px, font-weight 500
All inputs: padding 8px 10px, border-radius 6px, font-size 12px
Footer: Cancel + Test & save
```

### Confirm Dialog
```
Size: max-width 360px
Title: e.g. "Delete this Claw?"
Description: explains consequences
Warning box (delete): bg var(--errbg), border-radius 6px, padding 8px 10px, font-size 11px, color #991b1b
Footer: Cancel (outline) + action button
  Delete: .btn.bd (danger)
  Pause: .btn.bp with bg var(--warn)
```

---

## 6. Alert Banners (Dashboard)

### Tool Connection Expired
```
.warn-banner with 🔌 icon
Text: "HubSpot connection expired. ..."
Inline buttons: Reconnect (primary, 10px 3px 10px) + Manage tools (outline, 10px 3px 10px)
```

### API Spend Warning (80%)
```
.warn-banner with 💰 icon
Text: "API spend at 82% of ..."
Inline buttons: Increase limit + Optimize costs (both outline, 10px 3px 10px)
```

### API Spend Limit Reached (100%)
```
.err-banner with 🛑 icon
Text: "Monthly API spend limit reached..."
Inline button: Increase limit (primary, 10px 3px 10px)
```

---

## 7. Tailwind Class Mapping Reference

Quick lookup from mockup CSS values to Tailwind classes:

```
font-size: 9px   → text-[9px]
font-size: 10px  → text-[10px] or text-nano
font-size: 11px  → text-[11px] or text-micro
font-size: 12px  → text-[12px] or text-caption
font-size: 13px  → text-[13px] or text-body
font-size: 14px  → text-[14px]
font-size: 15px  → text-[15px] or text-title
font-size: 16px  → text-[16px]
font-size: 18px  → text-[18px] or text-heading
font-size: 20px  → text-[20px]
font-size: 22px  → text-[22px]
font-size: 24px  → text-[24px] or text-display
font-size: 26px  → text-[26px]
font-size: 28px  → text-[28px]

padding: 3px 10px  → px-2.5 py-[3px]
padding: 3px 12px  → px-3 py-[3px]
padding: 4px 12px  → px-3 py-1
padding: 5px 14px  → px-3.5 py-[5px]
padding: 6px 12px  → px-3 py-1.5
padding: 8px 12px  → px-3 py-2
padding: 8px 14px  → px-3.5 py-2
padding: 8px 24px  → px-6 py-2
padding: 8px 28px  → px-7 py-2
padding: 10px 16px → px-4 py-2.5
padding: 10px 24px → px-6 py-2.5
padding: 12px 14px → px-3.5 py-3
padding: 14px      → p-3.5
padding: 14px 18px → px-[18px] py-3.5
padding: 16px      → p-4
padding: 20px      → p-5

gap: 4px  → gap-1
gap: 5px  → gap-[5px]
gap: 6px  → gap-1.5
gap: 8px  → gap-2
gap: 10px → gap-2.5
gap: 14px → gap-3.5
gap: 16px → gap-4

border-radius: 6px  → rounded-sm (custom) or rounded-[6px]
border-radius: 8px  → rounded (custom default)
border-radius: 12px → rounded-lg (custom)
border-radius: 16px → rounded-xl (custom) or rounded-[16px]
border-radius: 50%  → rounded-full

Colors:
  var(--bg)    → bg-surface-primary
  var(--bg2)   → bg-surface-secondary
  var(--bg3)   → bg-surface-tertiary
  var(--tx)    → text-content-primary
  var(--tx2)   → text-content-secondary
  var(--tx3)   → text-content-tertiary
  var(--bd)    → border-border
  var(--ac)    → text-brand / bg-brand
  var(--acbg)  → bg-brand-light
  var(--ok)    → text-status-success / bg-status-success
  var(--okbg)  → bg-status-success-bg
  var(--warn)  → text-status-warning / bg-status-warning
  var(--warnbg)→ bg-status-warning-bg
  var(--err)   → text-status-error / bg-status-error
  var(--errbg) → bg-status-error-bg
  #92400e      → text-amber-800 (close) or text-[#92400e]
  #991b1b      → text-red-900 (close) or text-[#991b1b]
  #5b21b6      → text-violet-800 (close) or text-[#5b21b6]
  #7c3aed      → text-violet-600 (close) or text-[#7c3aed]
  #166534      → text-green-800 (close) or text-[#166534]
  #1e40af      → text-blue-800 (close) or text-[#1e40af]
  #9d174d      → text-pink-800 (close) or text-[#9d174d]
```
