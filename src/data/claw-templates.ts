export type ClawCategory = "MONEY_MAKING" | "CREATOR" | "BUSINESS_OPS" | "VERTICAL" | "LIFESTYLE"
export type AgentRole = "ORCHESTRATOR" | "WORKER" | "CRITIC"

export interface ClawAgent {
  name: string
  role: AgentRole
  color: string
  model: string
  roleDescription?: string
}

export interface ClawTemplate {
  name: string
  slug: string
  category: ClawCategory
  price: number
  tagline: string
  description: string
  agents: ClawAgent[]
  flowDescription: string
  requiredTools: string[]
  recommendedTools: string[]
  legalDisclaimer?: string
  agentCount: number
}

export const CATEGORY_META: Record<ClawCategory, { label: string; description: string }> = {
  MONEY_MAKING: {
    label: "Money-Making",
    description: "AI teams that directly generate revenue - trading, freelancing, and e-commerce.",
  },
  CREATOR: {
    label: "Creator",
    description: "Content creation machines - YouTube, Twitter, newsletters, and podcasts.",
  },
  BUSINESS_OPS: {
    label: "Business Ops",
    description: "Operational excellence - sales, agency management, SEO, and executive support.",
  },
  VERTICAL: {
    label: "Vertical",
    description: "Industry-specific teams - real estate, recruiting, medical, legal, and home services.",
  },
  LIFESTYLE: {
    label: "Lifestyle",
    description: "Personal productivity - fitness, studying, job hunting, and developer tools.",
  },
}

export const CLAW_TEMPLATES: ClawTemplate[] = [
  // ─── MONEY-MAKING ────────────────────────
  {
    name: "Quant Trader",
    slug: "quant-trader",
    category: "MONEY_MAKING",
    price: 299,
    agentCount: 7,
    tagline: "AI-powered market intelligence and trade execution",
    description: "A 7-agent team that scans markets, generates trading signals, manages risk, backtests strategies, and tracks your portfolio. Supports prediction markets (Polymarket), crypto (Binance/Coinbase/Kraken), and US stocks (Alpaca). Dual mode: Alert Only (default) or Autonomous execution with hard-coded risk limits.",
    agents: [
      { name: "Trade Commander", role: "ORCHESTRATOR", color: "#5BA1F5", model: "anthropic/claude-haiku-4-5" },
      { name: "Market Scanner", role: "WORKER", color: "#8BFCAE", model: "anthropic/claude-sonnet-4-6" },
      { name: "Signal Analyst", role: "WORKER", color: "#8b5cf6", model: "anthropic/claude-opus-4-6" },
      { name: "Risk Manager", role: "WORKER", color: "#FFDC6E", model: "anthropic/claude-sonnet-4-6" },
      { name: "Backtester", role: "WORKER", color: "#FFB1AB", model: "anthropic/claude-sonnet-4-6" },
      { name: "Portfolio Tracker", role: "WORKER", color: "#8BFCAE", model: "anthropic/claude-haiku-4-5" },
      { name: "Trade Thesis Reviewer", role: "CRITIC", color: "#8b5cf6", model: "anthropic/claude-opus-4-6" },
    ],
    flowDescription: "Market Scanner monitors markets every 30 min → Signal Analyst evaluates opportunities → Risk Manager enforces position limits → Backtester validates against historical data → Trade Commander presents thesis for human approval → Trade Thesis Reviewer ensures quality.",
    requiredTools: ["Claude API", "Tavily"],
    recommendedTools: ["Polymarket API", "Binance API", "Alpaca API", "Coinbase API", "Kraken API"],
    legalDisclaimer: "For research and signal intelligence only. Not financial advice. Past performance does not guarantee future results. Always consult a licensed financial advisor. Autonomous execution is opt-in with hard-coded risk limits enforced at the container level.",
  },
  {
    name: "Freelancer Revenue Engine",
    slug: "freelancer-revenue-engine",
    category: "MONEY_MAKING",
    price: 199,
    agentCount: 6,
    tagline: "Full client lifecycle automation for freelancers",
    description: "A 6-agent team that hunts leads, writes proposals, manages projects, handles invoicing, and identifies upsell opportunities. 100-point opportunity scoring. Scope creep detection. Collections escalation. Auto-pauses prospecting above 80% utilization.",
    agents: [
      { name: "Revenue Commander", role: "ORCHESTRATOR", color: "#5BA1F5", model: "anthropic/claude-haiku-4-5" },
      { name: "Lead Hunter", role: "WORKER", color: "#8BFCAE", model: "anthropic/claude-sonnet-4-6" },
      { name: "Proposal Writer", role: "WORKER", color: "#8b5cf6", model: "anthropic/claude-opus-4-6" },
      { name: "Project Manager", role: "WORKER", color: "#FFDC6E", model: "anthropic/claude-sonnet-4-6" },
      { name: "Invoice & Collections", role: "WORKER", color: "#FFB1AB", model: "anthropic/claude-haiku-4-5" },
      { name: "Business Development Reviewer", role: "CRITIC", color: "#8b5cf6", model: "anthropic/claude-opus-4-6" },
    ],
    flowDescription: "Lead Hunter scans platforms for opportunities → Proposal Writer crafts personalized proposals → Project Manager tracks deliverables and deadlines → Invoice & Collections handles billing → Business Development Reviewer quality-gates all client-facing communication.",
    requiredTools: ["Claude API", "Tavily"],
    recommendedTools: ["Gmail", "Upwork API", "LinkedIn", "Calendar", "Stripe", "FreshBooks"],
  },
  {
    name: "E-Commerce Profit Maximizer",
    slug: "e-commerce-profit-maximizer",
    category: "MONEY_MAKING",
    price: 199,
    agentCount: 7,
    tagline: "Full store operations - product research to ad optimization",
    description: "A 7-agent team covering product research, listing SEO, dynamic pricing, review management, and ad campaigns. Per-product P&L tracking. Buy Box strategy. Auto-pauses ads when ROAS drops below 1.0 for 48 hours.",
    agents: [
      { name: "Store Commander", role: "ORCHESTRATOR", color: "#5BA1F5", model: "anthropic/claude-haiku-4-5" },
      { name: "Product Researcher", role: "WORKER", color: "#8BFCAE", model: "anthropic/claude-sonnet-4-6" },
      { name: "Listing Optimizer", role: "WORKER", color: "#8b5cf6", model: "anthropic/claude-opus-4-6" },
      { name: "Pricing Intel", role: "WORKER", color: "#FFDC6E", model: "anthropic/claude-sonnet-4-6" },
      { name: "Review Manager", role: "WORKER", color: "#FFB1AB", model: "anthropic/claude-sonnet-4-6" },
      { name: "Ad Optimizer", role: "WORKER", color: "#8BFCAE", model: "anthropic/claude-sonnet-4-6" },
      { name: "E-Commerce Quality Gate", role: "CRITIC", color: "#8b5cf6", model: "anthropic/claude-opus-4-6" },
    ],
    flowDescription: "Product Researcher identifies winning products → Listing Optimizer writes SEO-optimized listings → Pricing Intel monitors competitor prices → Review Manager responds to reviews → Ad Optimizer manages campaigns → E-Commerce Quality Gate reviews all outputs.",
    requiredTools: ["Claude API", "Shopify or Amazon SP-API"],
    recommendedTools: ["Tavily", "Google Ads", "Meta Ads", "Keepa"],
  },

  // ─── CREATOR ─────────────────────────────
  {
    name: "YouTube Channel OS",
    slug: "youtube-channel-os",
    category: "CREATOR",
    price: 149,
    agentCount: 8,
    tagline: "Full content pipeline from trend to published video",
    description: "An 8-agent team for trend scanning, idea generation, CTR-scored titles, thumbnail briefs, retention-optimized scripts, SEO metadata, and community management. Post-publish monitoring every 6 hours for 72 hours. Weekly content planning.",
    agents: [
      { name: "Channel Commander", role: "ORCHESTRATOR", color: "#5BA1F5", model: "anthropic/claude-haiku-4-5" },
      { name: "Trend Scout", role: "WORKER", color: "#8BFCAE", model: "anthropic/claude-sonnet-4-6" },
      { name: "Idea Generator", role: "WORKER", color: "#8b5cf6", model: "anthropic/claude-opus-4-6" },
      { name: "Title & Thumbnail Architect", role: "WORKER", color: "#FFDC6E", model: "anthropic/claude-opus-4-6" },
      { name: "Script Builder", role: "WORKER", color: "#FFB1AB", model: "anthropic/claude-opus-4-6" },
      { name: "YouTube SEO Optimizer", role: "WORKER", color: "#8BFCAE", model: "anthropic/claude-sonnet-4-6" },
      { name: "Community Growth Engine", role: "WORKER", color: "#5BA1F5", model: "anthropic/claude-sonnet-4-6" },
      { name: "Content Quality Gate", role: "CRITIC", color: "#8b5cf6", model: "anthropic/claude-opus-4-6" },
    ],
    flowDescription: "Trend Scout identifies hot topics → Idea Generator creates content concepts → Title & Thumbnail Architect scores CTR potential → Script Builder writes retention-optimized scripts → SEO Optimizer handles metadata → Community Growth Engine manages comments → Content Quality Gate reviews everything.",
    requiredTools: ["Claude API", "YouTube Data API"],
    recommendedTools: ["Tavily", "VidIQ", "TubeBuddy", "Buffer", "Typefully", "Calendar"],
  },
  {
    name: "Twitter/X Growth Machine",
    slug: "twitter-x-growth-machine",
    category: "CREATOR",
    price: 149,
    agentCount: 6,
    tagline: "5 tweets daily, strategic engagement, growth tracking",
    description: "A 6-agent team producing a daily content calendar (educational, engagement, thread, conversational, casual), managing 3-tier engagement targeting, crafting replies, and tracking analytics. Ratio detection with viral response protocol.",
    agents: [
      { name: "Twitter Commander", role: "ORCHESTRATOR", color: "#5BA1F5", model: "anthropic/claude-haiku-4-5" },
      { name: "Trend & Topic Scout", role: "WORKER", color: "#8BFCAE", model: "anthropic/claude-sonnet-4-6" },
      { name: "Content Writer", role: "WORKER", color: "#8b5cf6", model: "anthropic/claude-opus-4-6" },
      { name: "Engagement Strategist", role: "WORKER", color: "#FFDC6E", model: "anthropic/claude-sonnet-4-6" },
      { name: "Analytics & Growth Tracker", role: "WORKER", color: "#FFB1AB", model: "anthropic/claude-haiku-4-5" },
      { name: "Social Content Reviewer", role: "CRITIC", color: "#8b5cf6", model: "anthropic/claude-opus-4-6" },
    ],
    flowDescription: "Trend Scout identifies daily topics → Content Writer drafts 5-tweet calendar → Engagement Strategist targets dream accounts, peers, and fans → Analytics Tracker monitors growth → Social Content Reviewer gates all public posts.",
    requiredTools: ["Claude API", "Twitter/X API"],
    recommendedTools: ["Typefully", "Buffer", "Tavily"],
  },
  {
    name: "Newsletter Empire",
    slug: "newsletter-empire",
    category: "CREATOR",
    price: 149,
    agentCount: 6,
    tagline: "Full editorial pipeline - research to monetization",
    description: "A 6-agent editorial team handling topic research, draft writing in your voice, growth strategies (cross-promos, referrals, lead magnets), and monetization (sponsors, paid subs). Open rate prediction on subject lines. Deliverability crisis handling.",
    agents: [
      { name: "Newsletter Commander", role: "ORCHESTRATOR", color: "#5BA1F5", model: "anthropic/claude-haiku-4-5" },
      { name: "Topic Researcher", role: "WORKER", color: "#8BFCAE", model: "anthropic/claude-sonnet-4-6" },
      { name: "Draft Writer", role: "WORKER", color: "#8b5cf6", model: "anthropic/claude-opus-4-6" },
      { name: "Growth Strategist", role: "WORKER", color: "#FFDC6E", model: "anthropic/claude-sonnet-4-6" },
      { name: "Monetization Optimizer", role: "WORKER", color: "#FFB1AB", model: "anthropic/claude-sonnet-4-6" },
      { name: "Editorial Quality Gate", role: "CRITIC", color: "#8b5cf6", model: "anthropic/claude-opus-4-6" },
    ],
    flowDescription: "Topic Researcher surfaces trending subjects → Draft Writer composes in your voice → Growth Strategist manages cross-promos and referral programs → Monetization Optimizer handles sponsors and paid conversions → Editorial Quality Gate ensures brand consistency.",
    requiredTools: ["Claude API", "Beehiiv or Substack or ConvertKit"],
    recommendedTools: ["Twitter API", "LinkedIn", "Buffer", "SparkLoop"],
  },
  {
    name: "Podcast Production Studio",
    slug: "podcast-production-studio",
    category: "CREATOR",
    price: 149,
    agentCount: 6,
    tagline: "Guest booking to 20-piece content repurposing",
    description: "A 6-agent team covering guest scoring and outreach, interview briefs with question lists, show notes with SEO, and 10-20 piece repurposing from a single transcript (threads, posts, clips, blog). Guest promotion package generation.",
    agents: [
      { name: "Podcast Commander", role: "ORCHESTRATOR", color: "#5BA1F5", model: "anthropic/claude-haiku-4-5" },
      { name: "Guest Researcher & Booker", role: "WORKER", color: "#8BFCAE", model: "anthropic/claude-sonnet-4-6" },
      { name: "Episode Planner", role: "WORKER", color: "#8b5cf6", model: "anthropic/claude-opus-4-6" },
      { name: "Show Notes & SEO Writer", role: "WORKER", color: "#FFDC6E", model: "anthropic/claude-sonnet-4-6" },
      { name: "Content Repurposer", role: "WORKER", color: "#FFB1AB", model: "anthropic/claude-sonnet-4-6" },
      { name: "Podcast Quality Gate", role: "CRITIC", color: "#8b5cf6", model: "anthropic/claude-opus-4-6" },
    ],
    flowDescription: "Guest Researcher scores and outreaches potential guests → Episode Planner creates interview briefs → Show Notes & SEO Writer writes metadata → Content Repurposer creates 10-20 pieces from one transcript → Podcast Quality Gate reviews all outputs.",
    requiredTools: ["Claude API", "Gmail", "Calendar"],
    recommendedTools: ["Tavily", "Twitter API", "LinkedIn", "Buffer", "Notion"],
  },

  // ─── BUSINESS OPS ────────────────────────
  {
    name: "B2B Sales Machine",
    slug: "b2b-sales-machine",
    category: "BUSINESS_OPS",
    price: 199,
    agentCount: 7,
    tagline: "ICP research → sequences → pipeline management",
    description: "A 7-agent outbound sales team with ICP research, lead enrichment, 5-email sequences (pattern interrupt → breakup), 7-category reply classification, and real-time hot lead alerts. CAN-SPAM compliance enforced.",
    agents: [
      { name: "Sales Commander", role: "ORCHESTRATOR", color: "#5BA1F5", model: "anthropic/claude-haiku-4-5" },
      { name: "ICP Researcher", role: "WORKER", color: "#8BFCAE", model: "anthropic/claude-sonnet-4-6" },
      { name: "Lead Enricher", role: "WORKER", color: "#5BA1F5", model: "anthropic/claude-sonnet-4-6" },
      { name: "Sequence Writer", role: "WORKER", color: "#8b5cf6", model: "anthropic/claude-opus-4-6" },
      { name: "Reply Handler", role: "WORKER", color: "#FFDC6E", model: "anthropic/claude-sonnet-4-6" },
      { name: "Pipeline Manager", role: "WORKER", color: "#FFB1AB", model: "anthropic/claude-sonnet-4-6" },
      { name: "Outbound Quality Gate", role: "CRITIC", color: "#8b5cf6", model: "anthropic/claude-opus-4-6" },
    ],
    flowDescription: "ICP Researcher defines ideal customer profile → Lead Enricher gathers prospect data → Sequence Writer crafts personalized email sequences → Reply Handler classifies and responds → Pipeline Manager tracks deals → Outbound Quality Gate ensures compliance.",
    requiredTools: ["Claude API", "Tavily"],
    recommendedTools: ["Apollo.io", "Clay.com", "Instantly.ai", "HubSpot", "Salesforce", "Calendly"],
  },
  {
    name: "Agency Operations OS",
    slug: "agency-operations-os",
    category: "BUSINESS_OPS",
    price: 199,
    agentCount: 7,
    tagline: "Multi-client operations on autopilot",
    description: "A 7-agent team for intake, SOW generation, resource allocation, project tracking, client reporting, and billing. Utilization tracking (target 75-85%). Per-project profitability. Scope creep detection with automatic change order drafting.",
    agents: [
      { name: "Agency Commander", role: "ORCHESTRATOR", color: "#5BA1F5", model: "anthropic/claude-haiku-4-5" },
      { name: "Intake & Scoping Agent", role: "WORKER", color: "#8BFCAE", model: "anthropic/claude-sonnet-4-6" },
      { name: "Resource Allocator", role: "WORKER", color: "#5BA1F5", model: "anthropic/claude-sonnet-4-6" },
      { name: "Client Reporter", role: "WORKER", color: "#8b5cf6", model: "anthropic/claude-sonnet-4-6" },
      { name: "Task Manager", role: "WORKER", color: "#FFDC6E", model: "anthropic/claude-haiku-4-5" },
      { name: "Finance Tracker", role: "WORKER", color: "#FFB1AB", model: "anthropic/claude-haiku-4-5" },
      { name: "Agency Quality Gate", role: "CRITIC", color: "#8b5cf6", model: "anthropic/claude-opus-4-6" },
    ],
    flowDescription: "Intake Agent qualifies leads and generates SOWs → Resource Allocator assigns team members → Task Manager tracks deliverables → Client Reporter creates status updates → Finance Tracker monitors profitability → Agency Quality Gate reviews all deliverables.",
    requiredTools: ["Claude API", "Linear or Asana or ClickUp"],
    recommendedTools: ["Slack", "Gmail", "Calendar", "Toggl", "Harvest", "Stripe", "QuickBooks"],
  },
  {
    name: "Founder's Chief of Staff",
    slug: "founders-chief-of-staff",
    category: "BUSINESS_OPS",
    price: 199,
    agentCount: 6,
    tagline: "Your personal operating system - briefings, prep, tracking",
    description: "A 6-agent personal ops team delivering daily 6:30 AM context briefings, meeting prep with attendee research, bi-directional commitment tracking, and executive communication drafting.",
    agents: [
      { name: "Chief of Staff", role: "ORCHESTRATOR", color: "#5BA1F5", model: "anthropic/claude-haiku-4-5" },
      { name: "Briefing Compiler", role: "WORKER", color: "#8BFCAE", model: "anthropic/claude-sonnet-4-6" },
      { name: "Meeting Prep Agent", role: "WORKER", color: "#5BA1F5", model: "anthropic/claude-sonnet-4-6" },
      { name: "Action Tracker", role: "WORKER", color: "#FFDC6E", model: "anthropic/claude-haiku-4-5" },
      { name: "Communication Drafter", role: "WORKER", color: "#8b5cf6", model: "anthropic/claude-opus-4-6" },
      { name: "Executive Quality Gate", role: "CRITIC", color: "#8b5cf6", model: "anthropic/claude-opus-4-6" },
    ],
    flowDescription: "Briefing Compiler aggregates overnight updates → Meeting Prep Agent researches attendees → Action Tracker monitors commitments (yours and others') → Communication Drafter handles executive emails → Executive Quality Gate reviews all outputs.",
    requiredTools: ["Claude API", "Gmail or Outlook", "Calendar"],
    recommendedTools: ["Slack", "Linear", "Asana", "Tavily", "LinkedIn", "Stripe"],
  },
  {
    name: "SEO Empire Builder",
    slug: "seo-empire-builder",
    category: "BUSINESS_OPS",
    price: 199,
    agentCount: 7,
    tagline: "Full SEO operation - keywords to backlinks to rankings",
    description: "A 7-agent SEO team handling keyword research with topic clustering, E-E-A-T compliant long-form content, technical SEO monitoring, backlink prospecting, and daily rank tracking. Prioritizes quick wins (low KD). YMYL content flagged for expert review.",
    agents: [
      { name: "SEO Commander", role: "ORCHESTRATOR", color: "#5BA1F5", model: "anthropic/claude-haiku-4-5" },
      { name: "Keyword Strategist", role: "WORKER", color: "#8BFCAE", model: "anthropic/claude-sonnet-4-6" },
      { name: "Content Writer", role: "WORKER", color: "#8b5cf6", model: "anthropic/claude-opus-4-6" },
      { name: "Technical SEO Monitor", role: "WORKER", color: "#FFDC6E", model: "anthropic/claude-sonnet-4-6" },
      { name: "Backlink Prospector", role: "WORKER", color: "#FFB1AB", model: "anthropic/claude-sonnet-4-6" },
      { name: "Rank Tracker", role: "WORKER", color: "#8BFCAE", model: "anthropic/claude-haiku-4-5" },
      { name: "SEO Quality Gate", role: "CRITIC", color: "#8b5cf6", model: "anthropic/claude-opus-4-6" },
    ],
    flowDescription: "Keyword Strategist identifies topic clusters → Content Writer produces E-E-A-T content → Technical SEO Monitor checks crawl errors and speed → Backlink Prospector finds link opportunities → Rank Tracker monitors daily positions → SEO Quality Gate reviews everything.",
    requiredTools: ["Claude API", "Google Search Console", "Google Analytics"],
    recommendedTools: ["Ahrefs", "SEMrush", "Tavily", "WordPress", "Webflow", "Gmail"],
  },

  // ─── VERTICAL ────────────────────────────
  {
    name: "Real Estate Agent OS",
    slug: "real-estate-agent-os",
    category: "VERTICAL",
    price: 199,
    agentCount: 6,
    tagline: "60-second lead response, CMAs, showing coordination",
    description: "A 6-agent team for 60-second lead response, Hot/Warm/Cold scoring, CMA generation, showing route optimization (max 5/day), weekly market updates, and past client nurture. Fair Housing compliance enforced.",
    agents: [
      { name: "Listing Commander", role: "ORCHESTRATOR", color: "#5BA1F5", model: "anthropic/claude-haiku-4-5" },
      { name: "Lead Qualifier", role: "WORKER", color: "#8BFCAE", model: "anthropic/claude-sonnet-4-6" },
      { name: "Market Intel Agent", role: "WORKER", color: "#5BA1F5", model: "anthropic/claude-sonnet-4-6" },
      { name: "Showing Coordinator", role: "WORKER", color: "#FFDC6E", model: "anthropic/claude-haiku-4-5" },
      { name: "Client Communicator", role: "WORKER", color: "#8b5cf6", model: "anthropic/claude-sonnet-4-6" },
      { name: "Real Estate Quality Gate", role: "CRITIC", color: "#8b5cf6", model: "anthropic/claude-opus-4-6" },
    ],
    flowDescription: "Lead Qualifier responds within 60 seconds and scores leads → Market Intel generates CMAs from comparables → Showing Coordinator optimizes daily routes → Client Communicator handles all follow-ups → Real Estate Quality Gate enforces Fair Housing compliance.",
    requiredTools: ["Claude API", "Gmail", "Calendar"],
    recommendedTools: ["MLS/IDX feed", "Zillow API", "Follow Up Boss", "Twilio"],
  },
  {
    name: "Recruiter OS",
    slug: "recruiter-os",
    category: "VERTICAL",
    price: 199,
    agentCount: 6,
    tagline: "Source → screen → schedule → report pipeline",
    description: "A 6-agent recruiting team for passive and active sourcing, resume screening against requirements, multi-round interview scheduling, and client pipeline reports. Anti-discrimination bias detection in the Critic.",
    agents: [
      { name: "Recruiting Commander", role: "ORCHESTRATOR", color: "#5BA1F5", model: "anthropic/claude-haiku-4-5" },
      { name: "Sourcer", role: "WORKER", color: "#8BFCAE", model: "anthropic/claude-sonnet-4-6" },
      { name: "Screening Agent", role: "WORKER", color: "#5BA1F5", model: "anthropic/claude-sonnet-4-6" },
      { name: "Interview Coordinator", role: "WORKER", color: "#FFDC6E", model: "anthropic/claude-haiku-4-5" },
      { name: "Client Reporter", role: "WORKER", color: "#8b5cf6", model: "anthropic/claude-sonnet-4-6" },
      { name: "Recruiting Quality Gate", role: "CRITIC", color: "#8b5cf6", model: "anthropic/claude-opus-4-6" },
    ],
    flowDescription: "Sourcer finds candidates via active and passive channels → Screening Agent evaluates against requirements → Interview Coordinator schedules rounds → Client Reporter delivers pipeline updates → Recruiting Quality Gate catches bias.",
    requiredTools: ["Claude API", "LinkedIn", "Gmail", "Calendar"],
    recommendedTools: ["Greenhouse", "Lever", "Bullhorn", "Tavily", "Calendly"],
  },
  {
    name: "Medical Practice Manager",
    slug: "medical-practice-manager",
    category: "VERTICAL",
    price: 199,
    agentCount: 6,
    tagline: "24/7 intake, appointment management, recall campaigns",
    description: "A 6-agent team for 24/7 patient intake, confirmation sequences (48h, 24h, 2h), recall campaigns for overdue patients, reactivation for lapsed patients, and review management. HIPAA compliance enforced by every agent.",
    agents: [
      { name: "Practice Commander", role: "ORCHESTRATOR", color: "#5BA1F5", model: "anthropic/claude-haiku-4-5" },
      { name: "Patient Intake Agent", role: "WORKER", color: "#8BFCAE", model: "anthropic/claude-sonnet-4-6" },
      { name: "Appointment Manager", role: "WORKER", color: "#5BA1F5", model: "anthropic/claude-haiku-4-5" },
      { name: "Recall & Reactivation Agent", role: "WORKER", color: "#FFDC6E", model: "anthropic/claude-sonnet-4-6" },
      { name: "Review & Reputation Manager", role: "WORKER", color: "#8b5cf6", model: "anthropic/claude-sonnet-4-6" },
      { name: "Healthcare Communication Gate", role: "CRITIC", color: "#8b5cf6", model: "anthropic/claude-opus-4-6" },
    ],
    flowDescription: "Patient Intake handles 24/7 new patient inquiries → Appointment Manager sends confirmation sequences → Recall Agent contacts overdue patients → Review Manager solicits and responds to reviews → Healthcare Communication Gate enforces HIPAA compliance on all outputs.",
    requiredTools: ["Claude API", "HIPAA-compliant SMS (Twilio BAA)", "Calendar"],
    recommendedTools: ["Dentrix", "Athena", "DrChrono", "Google Business Profile"],
  },
  {
    name: "Law Firm Intake OS",
    slug: "law-firm-intake-os",
    category: "VERTICAL",
    price: 199,
    agentCount: 6,
    tagline: "24/7 intake with emergency triage and conflict checking",
    description: "A 6-agent legal intake team with 24/7 intake, emergency triage (arrests, ICE, DV → immediate human alert within 15 min), practice-area-specific qualification, conflict checking, and consultation scheduling. Zero legal advice from any agent.",
    agents: [
      { name: "Intake Commander", role: "ORCHESTRATOR", color: "#5BA1F5", model: "anthropic/claude-haiku-4-5" },
      { name: "First Contact Agent", role: "WORKER", color: "#8BFCAE", model: "anthropic/claude-sonnet-4-6" },
      { name: "Case Qualifier", role: "WORKER", color: "#5BA1F5", model: "anthropic/claude-sonnet-4-6" },
      { name: "Conflict Checker", role: "WORKER", color: "#FFDC6E", model: "anthropic/claude-haiku-4-5" },
      { name: "Consultation Scheduler", role: "WORKER", color: "#8b5cf6", model: "anthropic/claude-haiku-4-5" },
      { name: "Legal Communication Gate", role: "CRITIC", color: "#8b5cf6", model: "anthropic/claude-opus-4-6" },
    ],
    flowDescription: "First Contact handles 24/7 intake with emergency triage → Case Qualifier evaluates against practice-area criteria → Conflict Checker verifies no conflicts of interest → Consultation Scheduler books with prep checklist → Legal Communication Gate rejects any unauthorized practice of law.",
    requiredTools: ["Claude API", "Gmail", "Calendar"],
    recommendedTools: ["Clio", "MyCase", "Typeform", "JotForm", "DocuSign", "Twilio", "Google Business Profile"],
  },
  {
    name: "Home Services Dispatcher",
    slug: "home-services-dispatcher",
    category: "VERTICAL",
    price: 199,
    agentCount: 5,
    tagline: "24/7 call handling with emergency triage and dispatch",
    description: "A 5-agent dispatch team for 24/7 call handling with emergency triage (gas leak → 911, flooding → emergency dispatch), service request matching, post-service follow-up, and maintenance plan upsells.",
    agents: [
      { name: "Dispatch Commander", role: "ORCHESTRATOR", color: "#5BA1F5", model: "anthropic/claude-haiku-4-5" },
      { name: "Call Handler", role: "WORKER", color: "#8BFCAE", model: "anthropic/claude-sonnet-4-6" },
      { name: "Dispatch Coordinator", role: "WORKER", color: "#FFDC6E", model: "anthropic/claude-haiku-4-5" },
      { name: "Customer Follow-Up Agent", role: "WORKER", color: "#8b5cf6", model: "anthropic/claude-sonnet-4-6" },
      { name: "Service Communication Gate", role: "CRITIC", color: "#8b5cf6", model: "anthropic/claude-opus-4-6" },
    ],
    flowDescription: "Call Handler triages emergencies (gas leak → evacuate + 911) and captures service requests → Dispatch Coordinator matches to nearest available tech → Customer Follow-Up handles post-service reviews and upsells → Service Communication Gate reviews all customer communication.",
    requiredTools: ["Claude API", "Calendar", "Twilio"],
    recommendedTools: ["ServiceTitan", "Housecall Pro", "Google Business Profile", "Tavily"],
  },

  // ─── LIFESTYLE ───────────────────────────
  {
    name: "Health & Fitness Commander",
    slug: "health-fitness-commander",
    category: "LIFESTYLE",
    price: 149,
    agentCount: 5,
    tagline: "Evidence-based workouts, nutrition, and habit tracking",
    description: "A 5-agent fitness team for personalized workout programming with progressive overload, nutrition planning by goal (cut/bulk/maintain), habit tracking, and recovery monitoring. Evidence-based only - no bro-science. Medical disclaimer enforced.",
    agents: [
      { name: "Fitness Commander", role: "ORCHESTRATOR", color: "#5BA1F5", model: "anthropic/claude-haiku-4-5" },
      { name: "Workout Planner", role: "WORKER", color: "#8BFCAE", model: "anthropic/claude-sonnet-4-6" },
      { name: "Nutrition Advisor", role: "WORKER", color: "#FFDC6E", model: "anthropic/claude-sonnet-4-6" },
      { name: "Habit & Recovery Tracker", role: "WORKER", color: "#8b5cf6", model: "anthropic/claude-haiku-4-5" },
      { name: "Health Quality Gate", role: "CRITIC", color: "#8b5cf6", model: "anthropic/claude-opus-4-6" },
    ],
    flowDescription: "Workout Planner creates progressive overload programs → Nutrition Advisor plans meals by goal → Habit & Recovery Tracker monitors sleep, water, and steps → Health Quality Gate rejects eating disorder triggers, fad diets, and unsupported claims.",
    requiredTools: ["Claude API"],
    recommendedTools: ["Google Calendar", "Apple Health", "Google Fit"],
  },
  {
    name: "Student Accelerator",
    slug: "student-accelerator",
    category: "LIFESTYLE",
    price: 149,
    agentCount: 5,
    tagline: "Study planning, research assistance, exam prep",
    description: "A 5-agent study team for study scheduling with spaced repetition, research assistance (literature search, source evaluation), and exam prep (practice questions, flashcards, concept maps). Academic integrity enforced - will NOT write essays or answer homework directly.",
    agents: [
      { name: "Study Commander", role: "ORCHESTRATOR", color: "#5BA1F5", model: "anthropic/claude-haiku-4-5" },
      { name: "Study Planner", role: "WORKER", color: "#8BFCAE", model: "anthropic/claude-sonnet-4-6" },
      { name: "Research Assistant", role: "WORKER", color: "#5BA1F5", model: "anthropic/claude-sonnet-4-6" },
      { name: "Exam Prep Coach", role: "WORKER", color: "#FFDC6E", model: "anthropic/claude-sonnet-4-6" },
      { name: "Academic Integrity Gate", role: "CRITIC", color: "#8b5cf6", model: "anthropic/claude-opus-4-6" },
    ],
    flowDescription: "Study Planner creates schedules with spaced repetition → Research Assistant evaluates sources and organizes notes → Exam Prep Coach generates practice questions and flashcards → Academic Integrity Gate ensures no essays are written or homework answered directly.",
    requiredTools: ["Claude API"],
    recommendedTools: ["Google Calendar", "Notion", "Google Docs", "Tavily"],
  },
  {
    name: "Job Hunter OS",
    slug: "job-hunter-os",
    category: "LIFESTYLE",
    price: 149,
    agentCount: 6,
    tagline: "Scan → apply → prep → negotiate - full job search pipeline",
    description: "A 6-agent job search team for opportunity scanning, per-application resume tailoring with ATS optimization, personalized cover letters, STAR-format interview prep, and salary negotiation strategy. Multi-offer comparison.",
    agents: [
      { name: "Job Hunt Commander", role: "ORCHESTRATOR", color: "#5BA1F5", model: "anthropic/claude-haiku-4-5" },
      { name: "Opportunity Scout", role: "WORKER", color: "#8BFCAE", model: "anthropic/claude-sonnet-4-6" },
      { name: "Application Crafter", role: "WORKER", color: "#8b5cf6", model: "anthropic/claude-opus-4-6" },
      { name: "Interview Coach", role: "WORKER", color: "#FFDC6E", model: "anthropic/claude-opus-4-6" },
      { name: "Negotiation Advisor", role: "WORKER", color: "#FFB1AB", model: "anthropic/claude-sonnet-4-6" },
      { name: "Job Search Quality Gate", role: "CRITIC", color: "#8b5cf6", model: "anthropic/claude-opus-4-6" },
    ],
    flowDescription: "Opportunity Scout scans job boards → Application Crafter tailors resume and cover letter per job → Interview Coach prepares STAR answers with company research → Negotiation Advisor develops salary strategy → Job Search Quality Gate reviews all applications.",
    requiredTools: ["Claude API", "Tavily"],
    recommendedTools: ["LinkedIn", "Gmail", "Calendar", "Google Docs", "Notion"],
  },
  {
    name: "Developer Productivity OS",
    slug: "developer-productivity-os",
    category: "LIFESTYLE",
    price: 149,
    agentCount: 7,
    tagline: "PR review, issue triage, security scanning, standups",
    description: "A 7-agent dev team for automated PR review with severity tiers, issue triage with effort estimation, API docs and changelog generation, OWASP Top 10 security scanning, dependency CVE monitoring, and daily standup compilation.",
    agents: [
      { name: "Dev Commander", role: "ORCHESTRATOR", color: "#5BA1F5", model: "anthropic/claude-haiku-4-5" },
      { name: "PR Reviewer", role: "WORKER", color: "#8BFCAE", model: "anthropic/claude-opus-4-6" },
      { name: "Issue Triager", role: "WORKER", color: "#5BA1F5", model: "anthropic/claude-sonnet-4-6" },
      { name: "Doc Generator", role: "WORKER", color: "#FFDC6E", model: "anthropic/claude-sonnet-4-6" },
      { name: "Security Scanner", role: "WORKER", color: "#FFB1AB", model: "anthropic/claude-sonnet-4-6" },
      { name: "Standup Writer", role: "WORKER", color: "#8BFCAE", model: "anthropic/claude-haiku-4-5" },
      { name: "Code Quality Gate", role: "CRITIC", color: "#8b5cf6", model: "anthropic/claude-opus-4-6" },
    ],
    flowDescription: "PR Reviewer analyzes code changes with severity tiers → Issue Triager estimates effort → Doc Generator creates API docs and changelogs → Security Scanner checks OWASP Top 10 → Standup Writer compiles daily updates → Code Quality Gate reviews everything.",
    requiredTools: ["Claude API", "GitHub or GitLab"],
    recommendedTools: ["Linear", "Jira", "Slack", "Snyk", "Notion"],
  },
]

export function getCategoryCounts(): Record<ClawCategory, number> {
  const counts = {} as Record<ClawCategory, number>
  for (const claw of CLAW_TEMPLATES) {
    counts[claw.category] = (counts[claw.category] || 0) + 1
  }
  return counts
}

export function getClawsByCategory(): Record<ClawCategory, ClawTemplate[]> {
  const grouped = {} as Record<ClawCategory, ClawTemplate[]>
  const order: ClawCategory[] = ["MONEY_MAKING", "CREATOR", "BUSINESS_OPS", "VERTICAL", "LIFESTYLE"]
  for (const cat of order) {
    grouped[cat] = CLAW_TEMPLATES.filter((c) => c.category === cat)
  }
  return grouped
}
