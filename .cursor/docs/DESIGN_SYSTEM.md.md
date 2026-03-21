# Claws — Design System
## Pixel-exact values extracted from mockups + component architecture
## This is the SINGLE SOURCE OF TRUTH. Cursor: use these exact values. Do not improvise.

---

# 1. TOKENS

## 1.1 Color Tokens (CSS Variables)

### Light Mode
```
--bg:    #ffffff    → surface-primary     (cards, modals, inputs)
--bg2:   #FBFBFB    → surface-secondary   (page backgrounds, pills, stat cards)
--bg3:   #F0F0F0    → surface-tertiary    (app body, skeleton base)
--tx:    #0A0A0B    → content-primary     (headings, primary text — brand near-black)
--tx2:   #777777    → content-secondary   (body text, descriptions)
--tx3:   #999999    → content-tertiary    (placeholders, disabled, timestamps)
--bd:    #EFEFEF    → border-default      (card borders, dividers, inputs)
--bd2:   #E0E0E0    → border-strong       (heavy dividers)
--ac:    #5BA1F5    → brand               (text links only — blue, hover to near-black)
--acbg:  #EEF5FF    → brand-light         (orchestrator bg, info bg)
--ok:    #10b981    → status-success       (functional — NOT brand mint)
--okbg:  #dcfce7    → status-success-bg
--warn:  #f59e0b    → status-warning       (functional — NOT brand gold)
--warnbg:#FFFCE8    → status-warning-bg
--err:   #ef4444    → status-error
--errbg: #fee2e2    → status-error-bg
```

### Brand Palette (from logo — used for category badges and agent dots)
```
Gold:    #FFDC6E    → Money-Making category, featured elements
Coral:   #FFB1AB    → Vertical category, attention states
Mint:    #8BFCAE    → Creator category, connected/healthy indicators
Blue:    #5BA1F5    → Business Ops category, primary brand (same as --ac)
Black:   #0A0A0B    → Text, active pills, sign-in button (same as --tx)
```

### Dark Mode
```
--bg:    #0A0A0B    --bg2:   #141416    --bg3:   #1E1E20
--tx:    #E5E5E5    --tx2:   #999999    --tx3:   #666666
--bd:    #2A2A2C    --bd2:   #3A3A3C
--ac:    #5BA1F5    --acbg:  #1A2A40
--ok:    #34d399    --okbg:  #064e3b
--warn:  #fbbf24    --warnbg:#451a03
--err:   #f87171    --errbg: #450a0a
```

### Category Badge Colors (from brand palette)
```
MONEY_MAKING:  bg #FFF8E7, text #8A6D00, border #FFE9A0
CREATOR:       bg #EDFFF3, text #0D6B32, border #B8FFCF
BUSINESS_OPS:  bg #EEF5FF, text #1A5BBF, border #A8CFFF
VERTICAL:      bg #FFF0EF, text #8B2018, border #FFD4D0
LIFESTYLE:     bg #F5F0FF, text #5B3A99, border #E0D0FF
```

### Agent Colors (from brand palette, fixed per slot)
```
Orchestrator:  #5BA1F5     Worker 4:  #FFDC6E
Worker 1:      #8BFCAE     Worker 5:  #FFB1AB
Worker 2:      #5BA1F5     Worker 6:  #8BFCAE
Worker 3:      #FFB1AB     Critic:    #A78BFA
```

### Color Usage Rules
```
Near-black var(--tx) used for:
  - All buttons (primary sign-in, CTAs)
  - Active nav items
  - Active category filter pills
  - Prices (setup + monthly)
  - Card hover borders → var(--bd2) (subtle darken, NOT blue)
  - Avatar circles
  - Headings, body text

Blue var(--ac) used for:
  - Text links ONLY (inline links, "Back to store", "Pricing" in nav when logged out)
  - Link hover: color var(--tx) (blue → near-black on hover)
  - Loading spinners, info badge backgrounds (functional indicators)
  - Screen section labels (doc reference only, not product UI)

Input focus:
  - All text inputs, textareas, selects: border-color var(--tx), outline none
  - Accessibility focus rings: outline 2px offset 2px var(--tx)
  - NEVER blue focus borders or rings

Blue is NEVER used for: buttons, prices, hover borders, active states, nav items, input focus borders, focus rings.
```

## 1.2 Border Radii
```
Standard: 8px   → buttons, inputs, stat cards, standard panels
Large:    12px  → cards (claw, workspace, tool-list), modals, deploy panels
Pill:     16px  → agent pills
Full:     50%   → dots, avatars, step circles
Small:    6px   → form inputs inside panels, compact elements, modal inputs
```

## 1.3 Typography
```
Body default: font-family 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif
              font-size 13px, line-height 1.5
              -webkit-font-smoothing: antialiased
Monospace:    font-family monospace (for API keys, code)
Load via:     <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" />
```

## 1.4 Shadows
```
Node shadow: 0 1px 2px rgba(0,0,0,0.04)     → agent nodes in builder
Modal shadow: 0 8px 30px rgba(0,0,0,0.12)    → modals only
All other elements: NO shadow (cards, buttons, etc. — border only)
```

---

# 2. COMPONENTS (Exact Pixel Specs)

## 2.1 TopBar

```
File: src/components/shared/top-bar.tsx

Container:
  display: flex, align-items: center, justify-content: space-between
  padding: 0 32px, height: 52px
  border-bottom: 1px solid var(--bd)
  background: var(--bg)

Logo: display flex, align-items center, gap 9px
  Icon: Claws logo SVG 24px × 24px (gradient sphere with colored stripes)
  Text: "Claws" — font-weight 700, font-size 16px, letter-spacing -0.5px, color var(--tx)
  NO split color. Single word in near-black.

Nav: display flex, gap 32px, font-size 13px, font-weight 500
  Inactive: color #999
  Active: color var(--tx)

Right (logged out): Sign in button — bg var(--tx), color #fff, padding 6px 16px, border-radius 8px, font-size 13px, font-weight 500
Right (logged in): Avatar circle 28px × 28px, rounded-full, bg var(--tx), color #fff, font-size 11px, font-weight 600
```

## 2.2 Button

```
File: src/components/ui/button.tsx

Base: font-size 11px, padding 5px 14px, border-radius 8px, border none, cursor pointer, font-weight 500, display inline-block

Variants:
  Primary (.bp):  background var(--tx), color #fff
  Outline (.bo):  background transparent, border 1px solid var(--bd), color var(--tx2)
  Danger (.bd):   background var(--err), color #fff

Size overrides (used contextually — apply via className):
  Category filter:  font-size 10px, padding 4px 12px
  Tool row action:  font-size 10px, padding 3px 10px
  Tiny action:      font-size 9px, padding 2px 6px
  Wizard CTA:       padding 8px 24px
  Large CTA:        padding 10px 24px, font-size 13px
  Full-width:       width 100%, padding 10px

Props: variant ("primary"|"outline"|"danger"|"ghost"), size ("default"|"sm"|"xs"|"lg"|"full"), children, disabled, loading, onClick, className
```

## 2.3 Category Badge

```
File: src/components/ui/category-badge.tsx

font-size: 11px, font-weight: 600, letter-spacing: 0.5px, text-transform: uppercase
padding: 3px 12px, border-radius: 8px, display: inline-block, margin-bottom: 6px

Colors: see Category Badge Colors above

Props: category (ClawCategory)
```

## 2.4 ClawCard

```
File: src/components/store/claw-card.tsx

Container:
  background: var(--bg)
  border: 1px solid var(--bd)
  border-radius: 12px
  padding: 14px 18px
  margin-bottom: 10px
  NO shadow
  Hover: border-color var(--bd2)

Header: display flex, justify-content space-between, align-items flex-start, margin-bottom 4px
  Name: font-size 15px, font-weight 600
  Price: font-size 13px, font-weight 600, color var(--tx), white-space nowrap
         Format: "$999 + $99/mo"

Description: font-size 12px, color var(--tx2), line-height 1.5, margin-bottom 10px

Agent pills container: display flex, flex-wrap wrap, gap 5px, margin-bottom 8px

Flow description: see FlowBox below

Legal disclaimer (if present): see LegalBox below

Props: name, slug, price{setup,monthly}, description, agents[], category, flowDescription, legalDisclaimer?
Click → /store/[slug]
```

## 2.5 Agent Pill

```
File: src/components/ui/agent-pill.tsx

font-size: 10px, padding: 3px 10px, border-radius: 16px
border: 1px solid var(--bd), color: var(--tx2), background: var(--bg2)
display: inline-flex, align-items: center, gap: 4px

Dot: width 6px, height 6px, border-radius 50%, flex-shrink 0, background [agent color via inline style]

Critic override: border-color #8b5cf6, color #5b21b6

Props: name (string), color (hex), role? (AgentRole)
```

## 2.6 Flow Box

```
(Used inside ClawCard and Claw Detail)

font-size: 11px, color: var(--tx2), font-style: italic, line-height: 1.5
padding: 8px 12px, background: var(--bg2), border-radius: 8px
border-left: 3px solid var(--bd)
```

## 2.7 Legal Disclaimer Box

```
font-size: 10px, color: #92400e, background: #fef3c7
padding: 6px 12px, border-radius: 8px, margin-top: 8px
border-left: 3px solid var(--warn)
```

## 2.8 Status Badge

```
File: src/components/ui/status-badge.tsx

font-size: 10px, padding: 2px 8px, border-radius: 12px, font-weight: 500
ALWAYS includes icon + text (accessibility — never color-only)

Running:   bg #dcfce7, color #10b981  → icon "●" text "Running"
Paused:    bg #fef3c7, color #f59e0b  → icon "⏸" text "Paused"
Error:     bg #fee2e2, color #ef4444  → icon "⚠" text "Error"
Draft:     bg #f3f4f6, color #9ca3af  → icon "○" text "Draft"
Setup:     bg #EEF5FF, color #5BA1F5  → icon "◐" text "Setup"
Deploying: bg #EEF5FF, color #5BA1F5  → icon spinner text "Deploying"
Stopped:   bg #fee2e2, color #ef4444  → icon "⏹" text "Stopped"

Props: status ("running"|"paused"|"error"|"draft"|"setup"|"deploying"|"stopped")
```

## 2.9 Status Dot (Tool Connection)

```
File: src/components/ui/status-dot.tsx

width: 9px, height: 9px, border-radius: 50%, flex-shrink: 0

Connected:    background var(--ok)
Disconnected: border 2px solid var(--bd), background transparent
Error:        background var(--err)
Connecting:   border 2px solid var(--ac), border-top-color transparent, animate spin

Props: status ("connected"|"disconnected"|"error"|"connecting")
```

## 2.10 Tool Row

```
File: src/components/setup/tool-row.tsx

Container: display flex, align-items center, justify-content space-between
           padding 12px 14px, border-bottom 1px solid var(--bd)
           last-child: no border-bottom

Left (.tool-info): display flex, align-items center, gap 8px
  Status Dot (2.9)
  Name: font-size 12px, font-weight 600
  Description: font-size 10px, color var(--tx2)

Right: action buttons (font-size 10px, padding 3px 10px)
  Connected: green status text
  Disconnected + API_KEY: "Enter API key" (primary)
  Disconnected + OAuth: "Connect via OAuth" (primary)
  Swappable: "Swap" button (outline)

Props: name, description, connectionStatus, connectionType, swappable?, onConnect, onSwap?, errorMessage?
```

## 2.11 Tool Connection List

```
File: src/components/setup/tool-connection-list.tsx

Title: font-size 14px, font-weight 600, margin-bottom 2px
Subtitle: font-size 11px, color var(--tx2), margin-bottom 10px
List: border 1px solid var(--bd), border-radius 12px, overflow hidden
  Children: ToolRow × N

Props: title, subtitle, tools[]
```

## 2.12 Stat Card

```
File: src/components/ui/stat-card.tsx

Grid container: display grid, grid-template-columns repeat(4, 1fr), gap 8px, margin-bottom 14px

Card: background var(--bg2), border-radius 8px, padding 12px
  Label: font-size 10px, color var(--tx2)
  Value: font-size 18px, font-weight 600, margin-top 2px
  Trend: font-size 10px, color var(--ok), margin-top 1px
  Alert value: color var(--warn) instead of default

Props: label, value, trend?, trendType?, alert?
```

## 2.13 Activity Log Entry

```
File: src/components/dashboard/activity-log-entry.tsx

Container: display flex, gap 8px, padding 5px 0, border-bottom 1px solid var(--bd), font-size 11px
           last-child: no border

Timestamp: color var(--tx3), min-width 40px, font-family monospace, font-size 10px
Agent name: font-weight 600, min-width 56px, color [agent-specific hex]
Message: color var(--tx2), flex 1

Props: timestamp, agentName, agentColor, message
```

## 2.14 Agent Hierarchy (Claw Detail)

```
File: src/components/store/agent-hierarchy.tsx

Container: display flex, flex-direction column, align-items center, gap 6px, margin 12px 0

Orchestrator:
  background var(--acbg), border 2px solid var(--ac), border-radius 8px
  padding 8px 18px, text-align center, min-width 180px
  Label: font-size 9px, color var(--ac), font-weight 600, uppercase, letter-spacing 0.5px
  Name: font-size 13px, font-weight 600
  Desc: font-size 10px, color var(--tx2)

Arrow: color var(--tx3), font-size 11px

Workers: display flex, gap 6px, flex-wrap wrap, justify-content center
  Each: border 1px solid var(--bd), border-radius 8px, padding 6px 12px
        text-align center, min-width 100px, border-left 3px solid [agent-color]
  Name: font-size 11px, font-weight 600
  Desc: font-size 9px, color var(--tx2)

Critic:
  background #ede9fe, border 2px solid #8b5cf6, border-radius 8px
  padding 8px 18px, text-align center, min-width 180px
  Label: font-size 9px, color #5b21b6, font-weight 600, uppercase, letter-spacing 0.5px
  Name: font-size 13px, font-weight 600, color #5b21b6
  Desc: font-size 10px, color #7c3aed

Props: orchestrator{name,desc}, workers[{name,desc,color}], critic{name,desc}
```

## 2.15 Wizard Progress Bar

```
File: src/components/setup/wizard-progress-bar.tsx

Container: display flex, align-items center, justify-content center, margin-bottom 20px, flex-wrap wrap

Step dot: width 26px, height 26px, border-radius 50%, display flex center, font-size 11px, font-weight 600
  Done:    bg var(--ok), color #fff, content "✓"
  Current: bg var(--tx), color #fff, content [number]
  Upcoming: border 1px solid var(--bd), color var(--tx3)

Step line: width 30px, height 1px, margin 0 3px
  Done: bg var(--ok)
  Todo: bg var(--bd)

Step label: font-size 10px, margin-left 4px, margin-right 8px
  Active: color var(--tx), font-weight 500
  Inactive: color var(--tx3)

Props: steps[{label, status: "complete"|"current"|"upcoming"}]
```

## 2.16 Workspace Card

```
File: src/components/my-claws/workspace-card.tsx

Container: border 1px solid var(--bd), border-radius 12px, padding 14px
           cursor pointer, transition border-color 0.15s
           Hover: border-color var(--bd2)
           NO shadow

Header: display flex, space-between, align-items flex-start, margin-bottom 6px
  Name: font-size 14px, font-weight 600
  StatusBadge (2.8)

Meta line: font-size 11px, color var(--tx2)
Meta row: display flex, gap 14px, font-size 11px, color var(--tx2), margin-top 4px

Grid container: display grid, grid-template-columns repeat(3, 1fr), gap 10px

Props: name, status, agentCount, lastActive, monthlyCost, source, onClick
Click routing: Running/Paused→dashboard, Draft→builder, Setup→wizard
```

## 2.17 Error Banner

```
File: src/components/ui/alert-banner.tsx (variant="error")

background: var(--errbg), border: 1px solid var(--err), border-radius: 8px
padding: 12px 14px, margin-bottom: 14px, display: flex, align-items: flex-start, gap: 8px

Icon: color var(--err), font-size 16px, flex-shrink 0
Text: font-size 12px, color #991b1b
Bold: font-weight 600

aria-live="assertive"
```

## 2.18 Warning Banner

```
File: src/components/ui/alert-banner.tsx (variant="warning")

background: var(--warnbg), border: 1px solid var(--warn), border-radius: 8px
padding: 12px 14px, margin-bottom: 14px, display: flex, align-items: flex-start, gap: 8px

Icon: color var(--warn), font-size 16px, flex-shrink 0
Text: font-size 12px, color #92400e

aria-live="polite"
```

## 2.19 Tabs

```
File: src/components/ui/tabs.tsx

Container: display flex, gap 0, border-bottom 1px solid var(--bd), margin-bottom 14px

Tab: padding 6px 14px, font-size 12px, color var(--tx2), cursor pointer
     border-bottom 2px solid transparent
Active: color var(--tx), border-bottom-color var(--tx), font-weight 500
```

## 2.20 Empty State

```
File: src/components/ui/empty-state.tsx

text-align: center, padding: 40px 20px, color: var(--tx2)
Title: font-size 16px, font-weight 600, color var(--tx), margin-bottom 6px
Body: font-size 13px, margin-bottom 14px
Border variant (My Claws): border 1px dashed var(--bd), border-radius 12px, padding 20px

Props: icon, title, description, actions?, bordered?
```

## 2.21 Loading Skeleton

```
File: src/components/ui/loading-skeleton.tsx

background: linear-gradient(90deg, var(--bg3) 25%, var(--bd) 50%, var(--bg3) 75%)
border-radius: 8px, animation: shimmer 1.5s infinite

Card: height 100px, border-radius 12px, margin-bottom 10px
Line: height 14px, margin-bottom 8px, width 80%
Short: height 14px, margin-bottom 8px, width 40%
```

## 2.22 Modal

```
File: src/components/ui/modal.tsx

Overlay: background rgba(0,0,0,0.3)

Box: background var(--bg), border 1px solid var(--bd), border-radius 12px
     padding 20px, margin 0 auto, box-shadow 0 8px 30px rgba(0,0,0,0.12)
     Standard: max-width 480px
     Large: max-width 560px
     Confirm: max-width 360px

Title: font-size 15px, font-weight 600, margin-bottom 4px
Desc: font-size 12px, color var(--tx2), margin-bottom 14px

Form label: font-size 11px, font-weight 500, display block, margin-bottom 3px
Form input: width 100%, padding 8px 10px, border 1px solid var(--bd), border-radius 6px, font-size 12px
  Focus: border-color var(--tx), outline none
Monospace: add font-family monospace

Footer: display flex, gap 6px, justify-content flex-end

Keyboard: Escape closes. Focus trapped. aria-modal="true" role="dialog"

Props: open, onClose, title, description?, children, footer?, size ("sm"|"md"|"lg")
```

## 2.23 Deploy Progress

```
File: src/components/setup/deploy-progress.tsx

Container: border 1px solid var(--bd), border-radius 12px, padding 14px
Title: font-size 13px, font-weight 600, margin-bottom 8px

Item: display flex, gap 8px, padding 4px 0, font-size 12px
  Icon: width 18px, text-align center
  Done: color var(--ok), "✓"
  Current: color var(--tx), "●"
  Waiting: color var(--tx3), "○"
  Failed: color var(--err), "✗", label bold

Props: steps[{label, status: "complete"|"running"|"pending"|"failed"}]
```

## 2.24 Plan Card

```
File: src/components/pricing/plan-card.tsx

Container: border 1px solid var(--bd), border-radius 12px, padding 20px, text-align center
Featured: border 2px solid var(--tx)
Featured label: font-size 10px, color var(--tx), font-weight 600, margin-bottom 4px

Name: font-size 18px, font-weight 600, margin-bottom 4px
Price: font-size 28px, font-weight 600, color var(--tx)
Period: font-size 12px, color var(--tx2)

Features: text-align left, font-size 12px, margin 14px 0, line-height 2.0
  Check: color var(--ok)
  Cross: color var(--tx3)

CTA: width 100%, padding 10px

Props: name, price, period, features[{text,included}], featured?, ctaLabel, ctaVariant, onCta
```

## 2.25 Input Fields

```
Standard: padding 8px 14px (search) or 8px 10px (form), border 1px solid var(--bd)
          border-radius 8px (search) or 6px (form), font-size 12px
Compact (builder): padding 5px 8px, border-radius 6px, font-size 11px
Textarea (builder): same + height 58px, resize none, font-size 10px, font-family monospace
Auth input: padding 10px 12px, border-radius 8px, font-size 13px, margin-bottom 8px
  Focus: border-color var(--tx), outline none
```

## 2.26 Pending Approval Card

```
File: src/components/dashboard/pending-approval-card.tsx

Container: display flex, space-between, align-items center
           bg var(--bg), padding 8px 10px, border-radius 6px
Text: font-size 11px
Action buttons: font-size 9px, padding 2px 8px

Props: title, description, actions[]
```

## 2.27 Agent Status Row

```
File: src/components/dashboard/agent-status-row.tsx

Container: display flex, space-between, padding 8px 10px, border-radius 6px
  Normal: bg var(--bg2)
  Paused: bg var(--warnbg)
  Error: bg var(--errbg)

Status dot: 8px × 8px
Name: font-size 12px, font-weight 600
  Critic: color #5b21b6
Meta: font-size 10px, color var(--tx2)
Note at bottom: font-size 10px, color var(--tx3), margin-top 8px

Props: name, role, status, lastActive, errorMessage?, queuedTasks?, canPause, onPause?, onResume?, onRestart?
Orchestrator + Critic: canPause=false (never show pause button)
```

## 2.28 Cost Breakdown Table

```
File: src/components/dashboard/cost-breakdown-table.tsx

Container: border 1px solid var(--bd), border-radius 12px, padding 14px
Header: display flex, space-between → title (font-size 13px, font-weight 600) + total (font-size 16px, font-weight 600, color var(--tx))
Table: font-size 12px, rows with border-bottom 1px solid var(--bd)
Tip box: font-size 11px, bg var(--bg2), border-radius 6px, padding 8px, margin-top 10px

Props: rows[{agentName,model,calls,cost}], totalCost, period, optimizationTip?
Sorted by cost descending
```

## 2.29 Auth Card

```
File: src/components/auth/auth-card.tsx

Container: max-width 400px, margin 30px auto, text-align center
Title: font-size 20px, font-weight 600, margin-bottom 4px
Subtitle: font-size 13px, color var(--tx2), margin-bottom 20px

OAuth button: display flex, center, gap 8px, width 100%, padding 10px
              border 1px solid var(--bd), border-radius 8px, margin-bottom 8px
              font-size 13px, background var(--bg)
              Hover: bg var(--bg2)
              Icon: 18px × 18px

Divider: display flex, center, margin 14px 0
  Lines: flex 1, height 1px, bg var(--bd)
  Text: margin 0 10px, font-size 11px, color var(--tx3)

Email input: see Auth input in 2.25
Magic link button: width 100%, padding 10px, font-size 13px (primary)
Footer: font-size 11px, color var(--tx3), margin-top 14px
```

## 2.30 Onboarding Step

```
File: src/components/onboarding/onboarding-step.tsx

Container: border 1px solid var(--bd), border-radius 12px, padding 16px
           text-align left, margin-bottom 12px
           Disabled: opacity 0.5

Header: display flex, gap 10px, align-items center, margin-bottom 8px
Number circle: width 28px, height 28px, border-radius 50%, font-size 12px, font-weight 600
  Active: bg var(--tx), color #fff
  Completed: bg var(--ok), color #fff, content "✓"
  Disabled: border 1px solid var(--bd), color var(--tx3)

Title: font-size 14px, font-weight 600
Description: font-size 11px, color var(--tx2)

Actions: display flex, gap 6px, margin-left 38px
  Buttons: font-size 11px

Props: number, title, description, actions, completed?, disabled?
```

## 2.31 Builder Agent Node

```
File: src/components/builder/agent-node.tsx (React Flow custom node)

Base: bg var(--bg), border 1px solid var(--bd), border-radius 8px
      padding 10px 12px, width 130px
      box-shadow: 0 1px 2px rgba(0,0,0,0.04)
  Title: font-size 11px, font-weight 600, margin-bottom 2px
  Desc: font-size 9px, color var(--tx2)
  Status dot: 6px × 6px, border-radius 50%, bg var(--ok), position absolute top 7px right 7px

Orchestrator: width 160px, border 2px solid var(--ac), bg var(--acbg)
Critic: width 160px, border 2px solid #8b5cf6, bg #ede9fe
```

## 2.32 Builder Panels

```
Left panel + Right panel:
  border 1px solid var(--bd), border-radius 8px, padding 10px, font-size 11px

Section title: font-size 10px, font-weight 600, color var(--tx2), uppercase, letter-spacing 0.5px, margin-bottom 8px

List item: display flex, gap 6px, padding 6px 8px, border-radius 6px, margin-bottom 3px, font-size 11px
  Hover: bg var(--bg2)
  Active: bg var(--acbg), color var(--ac)
  Orchestrator: bg var(--acbg), border-left 3px solid var(--ac), bold
  Critic: border-left 3px solid #8b5cf6, bold

Properties:
  Label: font-size 10px, color var(--tx2), margin-bottom 3px, font-weight 500
  Input: padding 5px 8px, border-radius 6px, font-size 11px
  Textarea: same + height 58px, resize none, font-size 10px, font-family monospace
  Select: same as input but font-size 10px

Canvas: bg var(--bg2), border 1px dashed var(--bd), border-radius 8px, padding 14px, min-height 340px

Builder grid: display grid, grid-template-columns 190px 1fr 190px, gap 10px, min-height 340px

Heartbeat bar: position absolute bottom 8px left 6px right 6px
  bg var(--bg), border 1px solid var(--bd), border-radius 6px, padding 6px 10px, font-size 10px
```

## 2.33 Model Selection Table

```
File: src/components/setup/model-selection-table.tsx

Table: width 100%, border-collapse collapse, font-size 12px, margin-bottom 14px
Header: font-size 11px, font-weight 600, color var(--tx2), padding 6px 8px
Cells: padding 6px 8px, border-bottom 1px solid var(--bd)
  Agent name: font-weight 600
  Role text: font-size 10px
    Orchestrator: color var(--ac)
    Worker: color var(--tx2)
    Critic: color #5b21b6
  Select: padding 3px 6px, border-radius 6px, font-size 11px
```

---

# 3. PER-SCREEN LAYOUT SPECS

## Screen 1: Store (/store)
```
Background: var(--bg2), body padding 16px
Hero: text-align center, padding 20px 0 16px
  Heading: font-size 20px, font-weight 600
  Subtitle: font-size 13px, color var(--tx2), margin-top 4px, max-width 500px centered
  Search: margin-top 12px, width 280px, padding 8px 14px, font-size 12px, border-radius 8px
  Filters: margin-top 10px, flex gap 6px centered, active=primary 10px/4px 12px, inactive=outline same
Category section: badge + description (font-size 11px, color var(--tx2), margin-bottom 8px) + ClawCard × N stacked
```

## Screen 2: Claw Detail (/store/[slug])
```
Background: var(--bg2), body padding 16px
Breadcrumb: font-size 11px, color var(--tx2), margin-bottom 10px, "← Back to store"
Title section: flex space-between
  Left: CategoryBadge → Name (font-size 22px, font-weight 600, margin-top 6px) → Desc (13px, var(--tx2), max-width 520px, line-height 1.6)
  Right: Price (26px, 600, var(--tx)) → Label (11px, var(--tx2)) → Monthly (14px, 500) → CTA (margin-top 10px, 8px 28px, 13px)
Hierarchy card: border var(--bd), border-radius 12px, padding 14px, margin-bottom 14px → AgentHierarchy inside
Tools grid: grid 1fr 1fr gap 10px, each card border+radius 12px padding 14px, title 13px 600
```

## Screen 3: My Claws (/my-claws)
```
Background: var(--bg), body padding 16px
Header: flex space-between, title 16px 600, actions flex gap 6px
Grid: grid 3 cols gap 10px → WorkspaceCard × N
Empty: border 1px dashed var(--bd), border-radius 12px, padding 20px → EmptyState
Loading: 3× skeleton cards in grid, height 100px
```

## Screen 4-8: Setup Wizard Steps
```
All steps: WizardProgressBar at top, body padding 16px
Step 1: Title 15px 600, subtitle 12px var(--tx2) mb 14px, API key card (border radius 12px padding 14px), model table, next button 8px 24px
Step 2: Two ToolConnectionList sections + extra action buttons (flex gap 8px, each flex 1 padding 8px outline), footer flex space-between
Step 3: Deploy grid (grid 2 cols gap 10px), deploy card (border radius 8px padding 14px center), featured card border 2px var(--tx), DeployProgress panel
Step 4: Channel list as tool-list format, footer flex space-between margin-top 14px
Step 5: Celebrate center padding 30px 20px, emoji 32px mb 8px, title 20px 600 mb 6px, tips box (bg2 radius 8px padding 14px 12px var(--tx2) line-height 1.8), CTAs margin-top 16px flex gap 8px centered 10px 24px 13px
```

## Screen 9: Builder
```
Body padding 10px
Grid: 190px 1fr 190px gap 10px min-height 340px
Left/Right panels: border var(--bd) radius 8px padding 10px
Canvas: bg var(--bg2) border 1px dashed var(--bd) radius 8px padding 14px min-height 340px
TopBar right: flex gap 6px, buttons outline font-size 10px, Deploy primary 10px
Empty: centered min-height 250px, emoji 40px, title 16px 600, CTA 10px 20px 13px
```

## Screen 10: Dashboard
```
Body padding 16px
Header: flex space-between mb 12px, name 16px 600, badge inline margin-left 6px
Stats: grid 4 cols gap 8px mb 14px → StatCard
Pending: border var(--warn) radius 8px padding 12px bg var(--warnbg) mb 14px, title 12px 600 #92400e mb 6px, items flex col gap 6px
Activity: border var(--bd) radius 8px padding 12px, title 13px 600 mb 8px, LogEntry × N
Agent status: border var(--bd) radius 12px padding 14px, title 13px 600 mb 10px
Cost breakdown: border var(--bd) radius 12px padding 14px
```

## Screen 11: Settings
```
Body padding 16px
Tabs component → tab content
API Keys: title 14px 600 mb 2px, subtitle 11px var(--tx2) mb 12px, tool-list format, action buttons 9px 2px 6px
Billing: title 14px 600 mb 2px, stat grid 3 cols (not 4) gap 8px, stat value 15px (not 18px), actions flex gap 6px
```

## Screen 12: Pricing
```
Background: var(--bg), body padding 16px text-align center
Title: 20px 600 mb 4px, subtitle 13px var(--tx2) mb 20px
Plan grid: grid 3 cols gap 14px mb 14px → PlanCard × 3
Explainer: border var(--bd) radius 12px padding 14px text-left, title 13px 600 mb 6px, body 12px var(--tx2) line-height 1.8
```

## Screen 13: Auth
```
Container: max-width 400px margin 30px auto text-align center
No "Sign in" in TopBar right on auth page
→ AuthCard (see 2.29)
```

## Screen 14: Onboarding
```
Container: max-width 560px margin 20px auto text-align center
Title: 24px 600 mb 6px, subtitle 14px var(--tx2) mb 24px
Steps: OnboardingStep × 3, gap 12px
Skip: font-size 11px color var(--ac) margin-top 16px
```

---

# 4. MODAL SPECS

## API Key Modal
```
Size: 480px. Title: "Connect {toolName}". Desc mentions encryption.
Input: monospace, 12px, 8px 10px, radius 6px. Help link: 11px var(--ac).
Validation states (11px): success=ok, error=err, validating=warn+spinner.
Footer: Cancel (outline) + Validate & save (primary)
```

## Browse Tools Modal
```
Size: 560px. Search + category filters (10px, 3px 8px outline) + tool-list with Connect buttons (10px, 3px 10px primary).
Footer count: 11px var(--tx3) centered. Close: align right.
```

## Custom API Modal
```
Size: 480px. Fields: name, base URL (monospace), auth type (select), credential (password monospace), description (textarea 60px).
Labels: 11px 500. Inputs: 8px 10px radius 6px 12px. Footer: Cancel + Test & save.
```

## Tool Swap Modal
```
Border 1px solid var(--ac), radius 12px, padding 14px, bg var(--acbg).
Title: 12px 600 var(--ac) mb 6px. Options: flex gap 6px wrap, each border var(--bd) radius 8px padding 6px 12px bg var(--bg) 11px.
```

## Confirm Dialog
```
Size: 360px. Delete: warning box bg var(--errbg) radius 6px padding 8px 10px 11px #991b1b. CTA: danger button.
Pause: CTA primary with bg var(--warn). Both have Cancel (outline).
```

---

# 5. ALERT BANNERS

```
Tool expired:  warn-banner, 🔌, inline Reconnect (primary 10px 3px 10px) + Manage tools (outline)
Spend 80%:     warn-banner, 💰, inline Increase limit + Optimize costs (both outline 10px 3px 10px)
Spend 100%:    err-banner, 🛑, inline Increase limit (primary 10px 3px 10px)
Paused:        warn-banner, ⏸, inline Resume agents (primary)
Container crash: err-banner, ⚠, inline Force restart (danger) + View logs + Check tools
```

---

# 6. ACCESSIBILITY RULES (every component)

```
□ Keyboard navigable (Tab, Enter, Escape)
□ Visible focus indicators (outline 2px offset 2px var(--tx))
□ Semantic HTML (button for actions, a for links, heading hierarchy h1→h2→h3)
□ aria-label on icon-only buttons
□ StatusBadge always icon+text (never color-only)
□ aria-live on dynamic content (activity feed: "polite", errors: "assertive")
□ prefers-reduced-motion: disable shimmer + spin animations
□ Modals: focus trap, Escape to close, aria-modal="true", return focus to trigger on close
□ Forms: associated labels or aria-label, aria-describedby for error messages
```

---

# 7. COMPONENT FILE MAP (52 files)

```
src/components/
├── ui/                        # Primitives
│   ├── button.tsx             # 2.2
│   ├── status-badge.tsx       # 2.8
│   ├── status-dot.tsx         # 2.9
│   ├── category-badge.tsx     # 2.3
│   ├── agent-pill.tsx         # 2.5
│   ├── input.tsx              # 2.25
│   ├── textarea.tsx           # 2.25
│   ├── select.tsx             # 2.25
│   ├── card.tsx               # Generic: border var(--bd) radius 12px padding per-context NO shadow
│   ├── modal.tsx              # 2.22
│   ├── alert-banner.tsx       # 2.17 + 2.18
│   ├── empty-state.tsx        # 2.20
│   ├── loading-skeleton.tsx   # 2.21
│   ├── stat-card.tsx          # 2.12
│   ├── confirm-dialog.tsx     # Modal + danger variant
│   └── tabs.tsx               # 2.19
├── shared/
│   ├── top-bar.tsx            # 2.1
│   ├── page-shell.tsx         # TopBar + main with bg
│   ├── page-header.tsx        # flex space-between title+actions
│   └── search-filter-bar.tsx  # search + filter pills + sort
├── store/
│   ├── claw-card.tsx          # 2.4
│   ├── claw-catalog.tsx       # Screen 1 page
│   ├── claw-detail-page.tsx   # Screen 2 page
│   ├── agent-hierarchy.tsx    # 2.14
│   └── tool-requirements.tsx  # Tools grid on detail
├── setup/
│   ├── wizard-progress-bar.tsx # 2.15
│   ├── wizard-step.tsx        # Wrapper with back/next
│   ├── model-selection-table.tsx # 2.33
│   ├── tool-connection-list.tsx # 2.11
│   ├── tool-row.tsx           # 2.10
│   ├── tool-swap-modal.tsx    # See Modal Specs
│   ├── api-key-modal.tsx      # See Modal Specs
│   ├── browse-tools-modal.tsx # See Modal Specs
│   ├── custom-api-modal.tsx   # See Modal Specs
│   ├── deploy-options.tsx     # Screen 6 cards
│   ├── deploy-progress.tsx    # 2.23
│   ├── channel-list.tsx       # Screen 7
│   └── channel-row.tsx        # Reuses ToolRow pattern
├── builder/
│   ├── agent-canvas.tsx       # React Flow wrapper
│   ├── agent-node.tsx         # 2.31
│   ├── agent-sidebar.tsx      # 2.32 left panel
│   ├── properties-panel.tsx   # 2.32 right panel
│   ├── heartbeat-config.tsx   # 2.32 bottom bar
│   ├── skill-picker.tsx       # Checkboxes in properties
│   └── markdown-editor.tsx    # Textarea for SOUL.md
├── dashboard/
│   ├── stat-cards.tsx         # Grid of StatCard
│   ├── activity-feed.tsx      # SSE container
│   ├── activity-log-entry.tsx # 2.13
│   ├── pending-approvals.tsx  # Section wrapper
│   ├── pending-approval-card.tsx # 2.26
│   ├── agent-status-list.tsx  # Container
│   ├── agent-status-row.tsx   # 2.27
│   └── cost-breakdown-table.tsx # 2.28
├── settings/
│   ├── account-settings.tsx
│   ├── api-key-manager.tsx
│   ├── api-key-row.tsx
│   ├── billing-dashboard.tsx
│   └── security-settings.tsx
├── pricing/
│   └── plan-card.tsx          # 2.24
├── auth/
│   └── auth-card.tsx          # 2.29
├── onboarding/
│   └── onboarding-step.tsx    # 2.30
└── my-claws/
    ├── workspace-grid.tsx
    └── workspace-card.tsx     # 2.16
```

---

# 8. TAILWIND CLASS MAPPING

Quick lookup from pixel values to Tailwind:

```
FONT SIZES:
9px → text-[9px]          14px → text-sm
10px → text-[10px]        15px → text-[15px]
11px → text-[11px]        16px → text-base
12px → text-xs            18px → text-lg
13px → text-[13px]        20px → text-xl
                          22px → text-[22px]
                          24px → text-2xl
                          26px → text-[26px]
                          28px → text-[28px]

PADDING:
3px 10px  → px-2.5 py-[3px]      10px 16px → px-4 py-2.5
3px 12px  → px-3 py-[3px]        10px 24px → px-6 py-2.5
4px 12px  → px-3 py-1            12px 14px → px-3.5 py-3
5px 8px   → px-2 py-[5px]        14px      → p-3.5
5px 14px  → px-3.5 py-[5px]      14px 18px → px-[18px] py-3.5
6px 12px  → px-3 py-1.5          16px      → p-4
6px 14px  → px-3.5 py-1.5        20px      → p-5
8px 10px  → px-2.5 py-2
8px 12px  → px-3 py-2
8px 14px  → px-3.5 py-2
8px 18px  → px-[18px] py-2
8px 24px  → px-6 py-2
8px 28px  → px-7 py-2

GAP:
4px → gap-1    8px → gap-2     14px → gap-3.5
5px → gap-[5px]  10px → gap-2.5  16px → gap-4
6px → gap-1.5

BORDER RADIUS:
6px  → rounded-[6px]   12px → rounded-xl     50% → rounded-full
8px  → rounded-lg       16px → rounded-[16px]

COLORS (var → Tailwind):
var(--bg)    → bg-[var(--bg)]    or bg-surface-primary (if tokens configured)
var(--bg2)   → bg-[var(--bg2)]
var(--bg3)   → bg-[var(--bg3)]
var(--tx)    → text-[var(--tx)]
var(--tx2)   → text-[var(--tx2)]
var(--tx3)   → text-[var(--tx3)]
var(--bd)    → border-[var(--bd)]
var(--ac)    → text-[var(--ac)]  or bg-[var(--ac)]
var(--acbg)  → bg-[var(--acbg)]
var(--ok)    → text-[var(--ok)]  or bg-[var(--ok)]
var(--okbg)  → bg-[var(--okbg)]
var(--warn)  → text-[var(--warn)]
var(--warnbg)→ bg-[var(--warnbg)]
var(--err)   → text-[var(--err)]
var(--errbg) → bg-[var(--errbg)]
#92400e      → text-[#92400e]
#991b1b      → text-[#991b1b]
#5b21b6      → text-[#5b21b6]
#7c3aed      → text-[#7c3aed]
```
