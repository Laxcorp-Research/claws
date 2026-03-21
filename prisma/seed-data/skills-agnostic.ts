import { SeedSkill } from "./types"

export const TOOL_AGNOSTIC_SKILLS: SeedSkill[] = [
  {
    name: "CRM Management",
    slug: "crm-management",
    description: "Universal CRM ops: contacts, deals, pipeline hygiene",
    skillMd: `## CRM Management

Universal framework for managing contacts, deals, and pipeline hygiene across any CRM.

### Contact Hygiene Checklist
- Deduplicate on email + company domain before creating new records
- Normalize phone numbers to E.164 format
- Tag source (inbound, outbound, referral, event) on every contact
- Merge duplicates weekly; preserve the record with the most activity

### Deal Pipeline Stages
1. **Prospect** — Initial research, no outreach yet
2. **Contacted** — First touch sent, awaiting response
3. **Qualified** — Budget, authority, need, timeline (BANT) confirmed
4. **Proposal** — Pricing/SOW delivered
5. **Negotiation** — Terms under discussion
6. **Closed-Won / Closed-Lost** — Final outcome with reason code

### Pipeline Hygiene Rules
- Deals with no activity for 14 days → auto-flag as stale
- Every deal must have a next action date and owner
- Closed-Lost requires a loss reason (price, timing, competitor, no-decision, other)
- Review pipeline weekly: total value, weighted forecast, stage conversion rates

### Data Entry Standards
- Company name: official legal name, no abbreviations
- Deal value: always in USD, convert at entry time
- Notes: timestamped, include attendee names and next steps`,
    type: "TOOL_AGNOSTIC",
    category: "CRM",
    icon: "📇",
    compatibleTools: ["*"],
    requiresToolConnection: false,
    isBuiltIn: false,
    permissions: [],
  },
  {
    name: "Cold Email Writing",
    slug: "cold-email-writing",
    description:
      "5-email sequence framework: pattern interrupt, social proof, value add, urgency, breakup",
    skillMd: `## Cold Email Writing

Structured 5-email outbound sequence with proven frameworks for each touch.

### Email 1 — Pattern Interrupt
- Subject line: question or unexpected stat (never "Quick question")
- Open with an observation specific to the prospect's company or role
- One clear value prop in a single sentence
- CTA: low-friction ask (reply yes/no, 15-min call, watch a 2-min video)
- Max 85 words body

### Email 2 — Social Proof (Day +3)
- Reference a similar company/role that got a specific result
- Format: "[Company] was facing [same problem]. After [action], they saw [metric]."
- Include one concrete number (%, $, time saved)
- Same low-friction CTA
- Max 65 words body

### Email 3 — Value Add (Day +7)
- Lead with a genuinely useful resource (benchmark report, checklist, template)
- No pitch — pure value
- Brief tie-back: "Thought this might help given [their situation]"
- CTA: optional, just "happy to chat if useful"
- Max 75 words body

### Email 4 — Urgency / Trigger Event (Day +12)
- Reference a timely trigger: earnings call, funding round, job posting, industry news
- Connect the trigger to your value prop
- Create natural urgency without fake scarcity
- Direct CTA: propose two specific times
- Max 70 words body

### Email 5 — Breakup (Day +18)
- Acknowledge you've reached out a few times
- Restate your single best value prop in one line
- Permission-based close: "Should I close your file, or is there a better time?"
- Leave the door open; never guilt-trip
- Max 50 words body

### Universal Rules
- Never use "I hope this email finds you well" or "Just following up"
- Personalize the first line with something you can only know from research
- One CTA per email, never two
- Plain text, no images, no HTML formatting in cold emails
- Send between 8–10 AM in the prospect's local timezone`,
    type: "TOOL_AGNOSTIC",
    category: "EMAIL_SENDER",
    icon: "✉️",
    compatibleTools: ["*"],
    requiresToolConnection: false,
    isBuiltIn: false,
    permissions: [],
  },
  {
    name: "Lead Scoring",
    slug: "lead-scoring",
    description:
      "100-point scoring model: ICP fit (40), engagement (30), buying intent (30)",
    skillMd: `## Lead Scoring

100-point scoring model to prioritize leads by likelihood to convert.

### Category 1 — ICP Fit (40 points max)
| Signal | Points |
|--------|--------|
| Company size matches ICP range | 10 |
| Industry is a target vertical | 10 |
| Job title is a decision-maker or champion | 10 |
| Geography in serviceable market | 5 |
| Tech stack includes relevant tools | 5 |

### Category 2 — Engagement (30 points max)
| Signal | Points |
|--------|--------|
| Opened 3+ emails in the last 14 days | 8 |
| Clicked a link or downloaded a resource | 7 |
| Replied to an email (positive/neutral) | 10 |
| Attended a webinar or event | 5 |

### Category 3 — Buying Intent (30 points max)
| Signal | Points |
|--------|--------|
| Visited pricing page | 10 |
| Requested a demo or trial | 10 |
| Mentioned budget or timeline in conversation | 5 |
| Published a relevant job posting | 5 |

### Score Tiers
- **80–100 — Hot**: Route to AE immediately, respond within 1 hour
- **60–79 — Warm**: Nurture with targeted content, AE follow-up within 24 hours
- **40–59 — Cool**: Continue automated sequence, review monthly
- **0–39 — Cold**: Park in long-term nurture, re-score quarterly

### Decay Rules
- Subtract 5 points per 30 days of no engagement
- Reset engagement score to 0 after 90 days of inactivity
- ICP fit score never decays

### Negative Signals (subtract points)
- Unsubscribed from emails: −15
- Bounced email (invalid): −20
- Competitor domain: −40 (flag and exclude)
- "Not interested" reply: −25`,
    type: "TOOL_AGNOSTIC",
    category: "LEAD_DATABASE",
    icon: "🎯",
    compatibleTools: ["*"],
    requiresToolConnection: false,
    isBuiltIn: false,
    permissions: [],
  },
  {
    name: "SEO Content Writing",
    slug: "seo-content-writing",
    description:
      "SEO article structure, E-E-A-T signals, internal linking, and readability",
    skillMd: `## SEO Content Writing

Framework for writing articles that rank and convert.

### Article Structure Template
1. **Title (H1)** — Include primary keyword, under 60 characters
2. **Meta description** — 150–160 chars, include keyword, end with CTA or benefit
3. **Introduction** (100–150 words) — Hook → problem → promise → brief roadmap
4. **H2 sections** — Each targets a subtopic or related keyword
5. **H3 subsections** — Break up H2s for scannability
6. **Conclusion** — Summarize key points, clear CTA
7. **FAQ section** — 3–5 questions from "People Also Ask" for featured snippets

### E-E-A-T Signals (Experience, Expertise, Authoritativeness, Trustworthiness)
- Include first-person experience or case study data where possible
- Cite primary sources with links (studies, official docs, data)
- Add author byline with relevant credentials
- Include publication and last-updated dates
- Link to authoritative external sources (government, .edu, industry leaders)

### Keyword Placement Checklist
- [ ] Primary keyword in H1, first 100 words, one H2, meta description
- [ ] Secondary keywords in H2s and naturally in body
- [ ] LSI/related terms sprinkled throughout (do not force)
- [ ] No keyword stuffing — aim for 1–2% density max

### Internal Linking Rules
- Link to 3–5 related articles per 1,000 words
- Use descriptive anchor text (never "click here")
- Link from high-authority pages to new content
- Update older articles to link to new posts

### Readability Standards
- Sentences: max 20 words average
- Paragraphs: max 3–4 sentences
- Flesch Reading Ease: aim for 60+ (8th grade level)
- Use bullet lists, numbered steps, and tables for scannability
- Bold key terms and takeaways

### Content Differentiation
- Add original data, screenshots, or examples competitors lack
- Include a unique angle or framework not found in top-10 results
- Create custom graphics or diagrams for complex concepts`,
    type: "TOOL_AGNOSTIC",
    category: "CONTENT",
    icon: "📝",
    compatibleTools: ["*"],
    requiresToolConnection: false,
    isBuiltIn: false,
    permissions: [],
  },
  {
    name: "Interview Preparation",
    slug: "interview-preparation",
    description:
      "STAR method, company research, and common question categories",
    skillMd: `## Interview Preparation

Structured framework for preparing candidates for job interviews.

### STAR Method for Behavioral Questions
- **Situation** — Set the scene in 1–2 sentences (company, team, context)
- **Task** — What was your specific responsibility or challenge?
- **Action** — What did YOU do? (Use "I", not "we") Be specific about steps
- **Result** — Quantify the outcome (%, $, time, scale). Include what you learned

### Company Research Checklist
- [ ] Mission, values, and recent press releases (last 6 months)
- [ ] Product/service overview — try the product if possible
- [ ] Key competitors and market position
- [ ] Recent earnings, funding, or growth metrics
- [ ] Glassdoor reviews — identify recurring themes
- [ ] LinkedIn profiles of interviewers (role, background, shared connections)
- [ ] Company engineering blog or tech stack (for technical roles)

### Common Question Categories & Prep
1. **Tell me about yourself** — 90-second pitch: present role → key achievement → why this role
2. **Behavioral** — Prepare 5 STAR stories covering: leadership, conflict, failure, collaboration, initiative
3. **Technical** — Review fundamentals for the role; practice on realistic problems
4. **Situational** — "What would you do if…" — use a structured approach: clarify → plan → execute → measure
5. **Culture fit** — Align answers to company values; give genuine examples
6. **Questions for them** — Prepare 5+, ask at least 3. Focus on team, growth, challenges

### Day-Of Checklist
- [ ] Review your STAR stories one final time
- [ ] Have a printed copy of your resume
- [ ] Arrive 10 minutes early (or test video/audio 15 min before virtual)
- [ ] Bring a notebook and pen for notes
- [ ] Prepare a concise "why this company" answer tied to your research

### Post-Interview
- Send a thank-you email within 24 hours
- Reference a specific topic from the conversation
- Reiterate your enthusiasm and fit in 3–4 sentences`,
    type: "TOOL_AGNOSTIC",
    category: "CORE",
    icon: "🎤",
    compatibleTools: ["*"],
    requiresToolConnection: false,
    isBuiltIn: false,
    permissions: [],
  },
  {
    name: "Project Scoping",
    slug: "project-scoping",
    description:
      "Discovery questions, effort estimation, and SOW template",
    skillMd: `## Project Scoping

Framework for scoping projects from discovery through SOW delivery.

### Discovery Questions (ask before estimating)
1. **Goal** — What does success look like? What metric moves?
2. **Users** — Who are the end users? How many? What's their technical level?
3. **Scope boundaries** — What is explicitly OUT of scope?
4. **Integrations** — Which existing systems must this connect to?
5. **Data** — What data exists? What format? Who owns it?
6. **Timeline** — Hard deadline or flexible? Any external dependencies?
7. **Budget** — Is there an approved budget range?
8. **Stakeholders** — Who approves? Who has veto power?
9. **Risks** — What has been tried before? Why did it fail?
10. **Compliance** — Any regulatory or security requirements?

### Effort Estimation Framework
Use **t-shirt sizes** for initial estimation, then refine:

| Size | Effort | Example |
|------|--------|---------|
| XS | < 1 day | Config change, copy update |
| S | 1–3 days | Single feature, API endpoint |
| M | 1–2 weeks | Feature set, integration |
| L | 3–6 weeks | Module, major feature |
| XL | 2–3 months | System, platform component |

**Estimation rules:**
- Add 30% buffer for unknowns on new domains
- Add 20% for third-party integration risk
- Multiply by 1.5x if requirements are still changing
- Break any XL into multiple L or M items

### SOW Template Outline
1. **Project overview** — 2–3 paragraph summary
2. **Objectives** — Numbered list of measurable goals
3. **Scope of work** — Deliverables with acceptance criteria
4. **Out of scope** — Explicit exclusions
5. **Timeline & milestones** — Gantt or table with dates
6. **Team & responsibilities** — RACI matrix
7. **Assumptions & dependencies** — What must be true
8. **Change process** — How scope changes are handled (written request → impact assessment → approval)
9. **Budget & payment schedule** — Fixed or T&M, milestone payments
10. **Acceptance criteria** — How deliverables are approved`,
    type: "TOOL_AGNOSTIC",
    category: "PROJECT_MGMT",
    icon: "📋",
    compatibleTools: ["*"],
    requiresToolConnection: false,
    isBuiltIn: false,
    permissions: [],
  },
  {
    name: "Salary Negotiation",
    slug: "salary-negotiation",
    description:
      "Market research methodology, negotiation strategy, and response templates",
    skillMd: `## Salary Negotiation

Framework for researching, strategizing, and executing salary negotiations.

### Market Research Phase
1. **Gather 3+ data points** from: Levels.fyi, Glassdoor, Payscale, LinkedIn Salary, H1B data (if applicable)
2. **Define your range** — Bottom: minimum you'd accept. Target: fair market rate. Stretch: top 10% for the role
3. **Factor in total comp** — Base, bonus, equity, benefits, PTO, remote flexibility, learning budget
4. **Adjust for** — Geography (cost of living), company stage (startup vs. enterprise), industry, your experience level

### Negotiation Strategy
- **Never give a number first** — Ask "What's the budgeted range for this role?" If pressed, give a range (target to stretch)
- **Anchor high** — Your first counter should be at or above your stretch number
- **Use silence** — After stating your number, stop talking. Let them respond
- **Never accept on the spot** — "Thank you, I'd like to take 24–48 hours to review the full package"
- **Negotiate the whole package** — If base is firm, negotiate: signing bonus, equity refresh, title, start date, review timeline, remote days

### Response Templates

**When asked for salary expectations:**
> "I'm focused on finding the right mutual fit. Could you share the budgeted range for this role so we can see if we're aligned?"

**When countering an offer:**
> "Thank you for the offer — I'm excited about the role. Based on my research and the value I'd bring, I was targeting [amount]. Is there flexibility to close that gap?"

**When base is firm:**
> "I understand the base may be fixed. Could we explore a signing bonus, accelerated review timeline, or additional equity to bridge the difference?"

**When accepting:**
> "I'm happy to accept at [agreed terms]. Could you send the updated offer letter? I'd like to have everything in writing before my start date."

### Common Mistakes to Avoid
- Don't reveal your current salary (illegal to ask in many states)
- Don't negotiate via email for the first round (call or video is better for rapport)
- Don't threaten to walk unless you mean it
- Don't compare yourself to colleagues — use market data only
- Don't forget to negotiate non-monetary perks (remote, PTO, equipment budget)`,
    type: "TOOL_AGNOSTIC",
    category: "CORE",
    icon: "💰",
    compatibleTools: ["*"],
    requiresToolConnection: false,
    isBuiltIn: false,
    permissions: [],
  },
  {
    name: "Code Review Framework",
    slug: "code-review-framework",
    description:
      "Severity tiers, review checklist, and constructive feedback style guide",
    skillMd: `## Code Review Framework

Structured approach to reviewing code with consistent severity, thoroughness, and tone.

### Severity Tiers
1. **🔴 Must-Fix (Blocker)** — Will cause bugs, data loss, security issues, or crashes in production. PR cannot merge until resolved.
2. **🟡 Should-Fix (Improvement)** — Performance issues, code smells, maintainability concerns, missing edge cases. Should be addressed before merge; can be deferred with a tracking issue.
3. **🟢 Nitpick (Suggestion)** — Style preferences, naming suggestions, minor refactors. Prefix with "nit:" so the author knows it's optional.

### Review Checklist
**Correctness**
- [ ] Does the code do what the PR description says?
- [ ] Are edge cases handled (null, empty, boundary values)?
- [ ] Are error paths handled gracefully?

**Security**
- [ ] No secrets, keys, or credentials in code
- [ ] User input is validated and sanitized
- [ ] SQL/NoSQL queries are parameterized
- [ ] Auth checks are present where needed

**Performance**
- [ ] No N+1 queries or unnecessary loops
- [ ] Large datasets use pagination or streaming
- [ ] Expensive operations are cached or batched where appropriate

**Maintainability**
- [ ] Functions are under 50 lines; files under 300 lines
- [ ] Names are descriptive and consistent with codebase conventions
- [ ] No dead code, commented-out blocks, or TODO without a ticket
- [ ] Complex logic has a brief explanatory comment

**Testing**
- [ ] New code has tests; existing tests still pass
- [ ] Tests cover happy path + at least one error path
- [ ] No flaky or time-dependent tests

### Feedback Style Guide
- **Be specific** — "This could NPE when \`user\` is null on line 42" not "This might break"
- **Suggest, don't demand** — "Consider extracting this into a helper" not "You need to refactor this"
- **Explain why** — "Using \`Map\` here would improve lookup from O(n) to O(1)" not just "Use a Map"
- **Acknowledge good work** — Call out clever solutions, clean abstractions, or good test coverage
- **Ask questions** — "Is there a reason we're not using the existing \`UserService\` here?" invites discussion
- **One comment per concern** — Don't pile multiple issues into one comment
- **Use code suggestions** — When possible, provide the exact code you'd write`,
    type: "TOOL_AGNOSTIC",
    category: "CORE",
    icon: "🔍",
    compatibleTools: ["*"],
    requiresToolConnection: false,
    isBuiltIn: false,
    permissions: [],
  },
]
