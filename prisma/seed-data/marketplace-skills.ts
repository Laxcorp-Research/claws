export interface MarketplaceSkillSeed {
  slug: string
  name: string
  description: string
  category: string
  tags: string[]
  emoji: string
  requiredBins: string[]
  requiredEnvVars: string[]
  isFree: boolean
  price: number | null
  trustTier: "OFFICIAL" | "SCANNED"
}

export function generateSkillMd(skill: MarketplaceSkillSeed): string {
  const envSection = skill.requiredEnvVars.length > 0
    ? `\n## Required Environment Variables\n${skill.requiredEnvVars.map(v => `- \`${v}\``).join("\n")}\n`
    : ""
  const binSection = skill.requiredBins.length > 0
    ? `\n## Required Binaries\n${skill.requiredBins.map(b => `- \`${b}\``).join("\n")}\n`
    : ""

  return `# ${skill.name}

${skill.description}
${envSection}${binSection}
## Usage

Use this skill when the user or agent needs ${skill.name.toLowerCase()} functionality. The skill handles authentication, request formatting, error handling, and structured response parsing automatically.

## Instructions

1. Verify all required environment variables and binaries are available before proceeding.
2. Parse the incoming request to determine the specific action or query.
3. Execute the appropriate operation using the relevant API or CLI tool.
4. Format results in a clear, structured format suitable for downstream agents.
5. If an error occurs, return a descriptive message with suggested remediation steps.

## Capabilities

- Full read and write operations where applicable
- Pagination support for list endpoints
- Rate-limit aware with automatic backoff
- Structured JSON output for agent consumption
`
}

export function installCountForSlug(slug: string): number {
  const hash = slug.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0)
  return (hash * 7) % 500 + 10
}

// ─── Developer (15 skills) ───────────────────────────────
const DEVELOPER: MarketplaceSkillSeed[] = [
  { slug: "git-operations", name: "Git Operations", description: "Clone, commit, push, pull, branch, and manage Git repositories programmatically.", category: "Developer", tags: ["git", "vcs", "repositories"], emoji: "🔀", requiredBins: ["git"], requiredEnvVars: [], isFree: true, price: null, trustTier: "OFFICIAL" },
  { slug: "github-issues", name: "GitHub Issues", description: "Create, label, assign, and close GitHub issues and pull requests.", category: "Developer", tags: ["github", "issues", "prs"], emoji: "🐙", requiredBins: ["gh"], requiredEnvVars: ["GITHUB_TOKEN"], isFree: true, price: null, trustTier: "OFFICIAL" },
  { slug: "code-formatter", name: "Code Formatter", description: "Format code in 20+ languages using Prettier, Black, gofmt, and language-specific formatters.", category: "Developer", tags: ["formatting", "code", "prettier"], emoji: "✨", requiredBins: [], requiredEnvVars: [], isFree: true, price: null, trustTier: "OFFICIAL" },
  { slug: "regex-builder", name: "Regex Builder", description: "Build, test, and apply regular expressions with named capture groups and multi-line support.", category: "Developer", tags: ["regex", "patterns", "text"], emoji: "🔤", requiredBins: [], requiredEnvVars: [], isFree: true, price: null, trustTier: "OFFICIAL" },
  { slug: "npm-package-manager", name: "NPM Package Manager", description: "Install, update, audit, and manage Node.js packages and dependencies.", category: "Developer", tags: ["npm", "node", "packages"], emoji: "📦", requiredBins: ["npm"], requiredEnvVars: [], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "docker-compose-helper", name: "Docker Compose Helper", description: "Build, run, and manage multi-container Docker applications.", category: "Developer", tags: ["docker", "containers", "devops"], emoji: "🐳", requiredBins: ["docker"], requiredEnvVars: [], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "jest-test-runner", name: "Jest Test Runner", description: "Run Jest tests, generate coverage reports, and analyze test results.", category: "Developer", tags: ["jest", "testing", "coverage"], emoji: "🧪", requiredBins: ["npx"], requiredEnvVars: [], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "eslint-fixer", name: "ESLint Fixer", description: "Run ESLint analysis, auto-fix violations, and report code quality metrics.", category: "Developer", tags: ["eslint", "linting", "quality"], emoji: "🔍", requiredBins: ["npx"], requiredEnvVars: [], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "typescript-compiler", name: "TypeScript Compiler", description: "Type-check, compile, and analyze TypeScript projects with diagnostics.", category: "Developer", tags: ["typescript", "types", "compiler"], emoji: "🔷", requiredBins: ["npx"], requiredEnvVars: [], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "api-client", name: "API Client", description: "Test REST and GraphQL APIs with request building, auth, and response parsing.", category: "Developer", tags: ["api", "rest", "graphql"], emoji: "🔌", requiredBins: [], requiredEnvVars: [], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "database-migrator", name: "Database Migrator", description: "Generate, run, and rollback database migrations for SQL and NoSQL databases.", category: "Developer", tags: ["migrations", "database", "schema"], emoji: "🗄️", requiredBins: [], requiredEnvVars: [], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "git-hooks-manager", name: "Git Hooks Manager", description: "Configure pre-commit, pre-push, and commit-msg hooks with Husky and lint-staged.", category: "Developer", tags: ["git-hooks", "husky", "automation"], emoji: "🪝", requiredBins: ["git"], requiredEnvVars: [], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "code-reviewer", name: "Code Reviewer", description: "Automated code review with bug detection, style suggestions, and improvement tips.", category: "Developer", tags: ["review", "quality", "analysis"], emoji: "👀", requiredBins: [], requiredEnvVars: [], isFree: false, price: 9, trustTier: "SCANNED" },
  { slug: "snyk-scanner", name: "Snyk Scanner", description: "Scan code and dependencies for known vulnerabilities and license issues.", category: "Developer", tags: ["snyk", "vulnerabilities", "dependencies"], emoji: "🛡️", requiredBins: ["snyk"], requiredEnvVars: ["SNYK_TOKEN"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "standup-writer", name: "Standup Writer", description: "Generate daily standup summaries from Git activity, issues, and calendar events.", category: "Developer", tags: ["standup", "reporting", "daily"], emoji: "🎙️", requiredBins: [], requiredEnvVars: [], isFree: true, price: null, trustTier: "SCANNED" },
]

// ─── System (12 skills) ──────────────────────────────────
const SYSTEM: MarketplaceSkillSeed[] = [
  { slug: "file-system-ops", name: "File System Operations", description: "Read, write, move, copy, and manage files and directories with glob pattern support.", category: "System", tags: ["files", "io", "filesystem"], emoji: "📁", requiredBins: [], requiredEnvVars: [], isFree: true, price: null, trustTier: "OFFICIAL" },
  { slug: "shell-executor", name: "Shell Executor", description: "Execute shell commands with timeout, output capture, and environment isolation.", category: "System", tags: ["shell", "cli", "terminal"], emoji: "💻", requiredBins: [], requiredEnvVars: [], isFree: true, price: null, trustTier: "OFFICIAL" },
  { slug: "memory-store", name: "Memory Store", description: "Persistent key-value memory for agents to store and retrieve context across sessions.", category: "System", tags: ["memory", "state", "context"], emoji: "🧠", requiredBins: [], requiredEnvVars: [], isFree: true, price: null, trustTier: "OFFICIAL" },
  { slug: "env-manager", name: "Environment Manager", description: "Safely read, validate, and manage environment variables with secret masking.", category: "System", tags: ["env", "config", "secrets"], emoji: "🔧", requiredBins: [], requiredEnvVars: [], isFree: true, price: null, trustTier: "OFFICIAL" },
  { slug: "cron-scheduler", name: "Cron Scheduler", description: "Schedule and manage recurring tasks using cron expressions with timezone support.", category: "System", tags: ["cron", "scheduling", "automation"], emoji: "⏰", requiredBins: [], requiredEnvVars: [], isFree: true, price: null, trustTier: "OFFICIAL" },
  { slug: "docker-manager", name: "Docker Manager", description: "Manage Docker containers, images, networks, and volumes programmatically.", category: "System", tags: ["docker", "containers", "devops"], emoji: "🐋", requiredBins: ["docker"], requiredEnvVars: [], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "log-analyzer", name: "Log Analyzer", description: "Parse, search, and analyze application logs with pattern matching and aggregation.", category: "System", tags: ["logs", "monitoring", "analysis"], emoji: "📜", requiredBins: [], requiredEnvVars: [], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "process-manager", name: "Process Manager", description: "List, monitor, start, stop, and manage system processes with resource tracking.", category: "System", tags: ["processes", "monitoring", "admin"], emoji: "⚙️", requiredBins: [], requiredEnvVars: [], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "disk-monitor", name: "Disk Monitor", description: "Monitor disk usage, quota, filesystem health, and storage alerts.", category: "System", tags: ["disk", "storage", "monitoring"], emoji: "💾", requiredBins: [], requiredEnvVars: [], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "ssh-manager", name: "SSH Manager", description: "Manage SSH connections, execute remote commands, and transfer files securely.", category: "System", tags: ["ssh", "remote", "admin"], emoji: "🔑", requiredBins: ["ssh"], requiredEnvVars: [], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "nginx-config", name: "Nginx Config", description: "Generate, validate, and manage Nginx configuration files and reverse proxy rules.", category: "System", tags: ["nginx", "proxy", "web-server"], emoji: "🌐", requiredBins: [], requiredEnvVars: [], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "ssl-cert-manager", name: "SSL Cert Manager", description: "Generate, renew, and manage SSL/TLS certificates with Let's Encrypt support.", category: "System", tags: ["ssl", "certificates", "tls"], emoji: "🔏", requiredBins: [], requiredEnvVars: [], isFree: true, price: null, trustTier: "SCANNED" },
]

// ─── Productivity (18 skills) ────────────────────────────
const PRODUCTIVITY: MarketplaceSkillSeed[] = [
  { slug: "google-calendar-sync", name: "Google Calendar", description: "Create, update, and query events on Google Calendar with recurrence support.", category: "Productivity", tags: ["google", "calendar", "events"], emoji: "📅", requiredBins: [], requiredEnvVars: ["GOOGLE_CALENDAR_CREDENTIALS"], isFree: true, price: null, trustTier: "OFFICIAL" },
  { slug: "linear-issues", name: "Linear Issues", description: "Create, update, and query issues, projects, and cycles in Linear.", category: "Productivity", tags: ["linear", "issues", "agile"], emoji: "🔵", requiredBins: [], requiredEnvVars: ["LINEAR_API_KEY"], isFree: true, price: null, trustTier: "OFFICIAL" },
  { slug: "notion-manager", name: "Notion Manager", description: "Create and query Notion databases, pages, and blocks with rich content.", category: "Productivity", tags: ["notion", "databases", "docs"], emoji: "📓", requiredBins: [], requiredEnvVars: ["NOTION_API_KEY"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "jira-manager", name: "Jira Manager", description: "Manage Jira issues, sprints, boards, and JQL queries across projects.", category: "Productivity", tags: ["jira", "atlassian", "sprints"], emoji: "🔷", requiredBins: [], requiredEnvVars: ["JIRA_API_TOKEN", "JIRA_DOMAIN"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "asana-tasks", name: "Asana Tasks", description: "Create and manage tasks, projects, and sections in Asana workspaces.", category: "Productivity", tags: ["asana", "tasks", "projects"], emoji: "🟣", requiredBins: [], requiredEnvVars: ["ASANA_ACCESS_TOKEN"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "clickup-tasks", name: "ClickUp Tasks", description: "Manage tasks, lists, and spaces in ClickUp with custom fields and automations.", category: "Productivity", tags: ["clickup", "tasks", "custom-fields"], emoji: "🟪", requiredBins: [], requiredEnvVars: ["CLICKUP_API_KEY"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "trello-boards", name: "Trello Boards", description: "Manage Trello boards, lists, and cards with labels, checklists, and due dates.", category: "Productivity", tags: ["trello", "kanban", "boards"], emoji: "📌", requiredBins: [], requiredEnvVars: ["TRELLO_API_KEY", "TRELLO_TOKEN"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "todoist-manager", name: "Todoist Manager", description: "Manage personal tasks, projects, labels, and filters in Todoist.", category: "Productivity", tags: ["todoist", "personal", "tasks"], emoji: "✅", requiredBins: [], requiredEnvVars: ["TODOIST_API_TOKEN"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "calendly-scheduling", name: "Calendly Scheduling", description: "Create booking links, manage availability, and process scheduling events.", category: "Productivity", tags: ["calendly", "booking", "scheduling"], emoji: "🗓️", requiredBins: [], requiredEnvVars: ["CALENDLY_API_KEY"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "outlook-calendar", name: "Outlook Calendar", description: "Manage events, meetings, and availability in Microsoft Outlook Calendar.", category: "Productivity", tags: ["outlook", "microsoft", "meetings"], emoji: "📆", requiredBins: [], requiredEnvVars: ["OUTLOOK_CLIENT_ID", "OUTLOOK_CLIENT_SECRET"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "cal-com-booking", name: "Cal.com Booking", description: "Open-source scheduling with team pages, round-robin, and custom workflows.", category: "Productivity", tags: ["cal", "open-source", "scheduling"], emoji: "📋", requiredBins: [], requiredEnvVars: ["CALCOM_API_KEY"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "meeting-prep", name: "Meeting Prep", description: "Auto-generate agendas, talking points, and attendee research for upcoming meetings.", category: "Productivity", tags: ["meetings", "prep", "agendas"], emoji: "📝", requiredBins: [], requiredEnvVars: [], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "daily-planner", name: "Daily Planner", description: "Generate optimized daily schedules with time-blocking and priority weighting.", category: "Productivity", tags: ["planning", "time-blocking", "productivity"], emoji: "📐", requiredBins: [], requiredEnvVars: [], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "project-scoping", name: "Project Scoping", description: "Break down project ideas into milestones, tasks, and time estimates.", category: "Productivity", tags: ["scoping", "estimation", "planning"], emoji: "🗺️", requiredBins: [], requiredEnvVars: [], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "timezone-converter", name: "Timezone Converter", description: "Convert times across timezones, find meeting windows, and detect DST transitions.", category: "Productivity", tags: ["timezone", "conversion", "global"], emoji: "🌍", requiredBins: [], requiredEnvVars: [], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "clipboard-manager", name: "Clipboard Manager", description: "Copy and paste content to system clipboard with format preservation.", category: "Productivity", tags: ["clipboard", "copy", "paste"], emoji: "📎", requiredBins: [], requiredEnvVars: [], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "availability-finder", name: "Availability Finder", description: "Find common free slots across multiple calendars for group scheduling.", category: "Productivity", tags: ["availability", "group", "scheduling"], emoji: "🔎", requiredBins: [], requiredEnvVars: [], isFree: false, price: 5, trustTier: "SCANNED" },
  { slug: "habit-tracker", name: "Habit Tracker", description: "Track daily habits, streaks, and goal progress with reminders and reporting.", category: "Productivity", tags: ["habits", "streaks", "goals"], emoji: "🎯", requiredBins: [], requiredEnvVars: [], isFree: true, price: null, trustTier: "SCANNED" },
]

// ─── Search (10 skills) ──────────────────────────────────
const SEARCH: MarketplaceSkillSeed[] = [
  { slug: "web-search-pro", name: "Web Search Pro", description: "Advanced web search with multi-engine aggregation, snippet extraction, and source ranking.", category: "Search", tags: ["search", "web", "research"], emoji: "🔎", requiredBins: [], requiredEnvVars: ["TAVILY_API_KEY"], isFree: true, price: null, trustTier: "OFFICIAL" },
  { slug: "tavily-search", name: "Tavily Search", description: "AI-optimized web search with clean extracted content and source citations.", category: "Search", tags: ["tavily", "ai-search", "research"], emoji: "🔍", requiredBins: [], requiredEnvVars: ["TAVILY_API_KEY"], isFree: true, price: null, trustTier: "OFFICIAL" },
  { slug: "brave-search", name: "Brave Search", description: "Privacy-focused web search with no tracking, independent index.", category: "Search", tags: ["brave", "privacy", "web"], emoji: "🦁", requiredBins: [], requiredEnvVars: ["BRAVE_SEARCH_API_KEY"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "duckduckgo-search", name: "DuckDuckGo Search", description: "Private web search with instant answers and zero-click results.", category: "Search", tags: ["duckduckgo", "privacy", "search"], emoji: "🦆", requiredBins: [], requiredEnvVars: [], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "arxiv-papers", name: "arXiv Papers", description: "Search, fetch, and summarize academic papers from arXiv preprint server.", category: "Search", tags: ["arxiv", "papers", "academic"], emoji: "🎓", requiredBins: [], requiredEnvVars: [], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "wikipedia-lookup", name: "Wikipedia Lookup", description: "Query Wikipedia articles, summaries, and structured data from Wikidata.", category: "Search", tags: ["wikipedia", "knowledge", "encyclopedia"], emoji: "📚", requiredBins: [], requiredEnvVars: [], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "google-scholar", name: "Google Scholar", description: "Search academic publications, citations, and author profiles.", category: "Search", tags: ["google-scholar", "citations", "academic"], emoji: "🔬", requiredBins: [], requiredEnvVars: [], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "stack-overflow", name: "Stack Overflow", description: "Search and retrieve programming Q&A from Stack Overflow with code snippets.", category: "Search", tags: ["stackoverflow", "programming", "qa"], emoji: "📦", requiredBins: [], requiredEnvVars: ["STACKOVERFLOW_API_KEY"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "semantic-search", name: "Semantic Search", description: "Vector-based semantic search over document collections using embeddings.", category: "Search", tags: ["semantic", "vectors", "embeddings"], emoji: "🧮", requiredBins: [], requiredEnvVars: [], isFree: false, price: 14, trustTier: "SCANNED" },
  { slug: "rag-retriever", name: "RAG Retriever", description: "Retrieval-augmented generation with chunking, embedding, and context assembly.", category: "Search", tags: ["rag", "retrieval", "llm"], emoji: "🧩", requiredBins: [], requiredEnvVars: [], isFree: false, price: 19, trustTier: "SCANNED" },
]

// ─── Communication (10 skills) ───────────────────────────
const COMMUNICATION: MarketplaceSkillSeed[] = [
  { slug: "slack-messenger", name: "Slack Messenger", description: "Send messages, manage channels, search history, and post rich blocks in Slack.", category: "Communication", tags: ["slack", "messaging", "channels"], emoji: "💬", requiredBins: [], requiredEnvVars: ["SLACK_BOT_TOKEN"], isFree: true, price: null, trustTier: "OFFICIAL" },
  { slug: "discord-bot", name: "Discord Bot", description: "Send messages, manage servers, create embeds, and handle events in Discord.", category: "Communication", tags: ["discord", "bot", "communities"], emoji: "🎮", requiredBins: [], requiredEnvVars: ["DISCORD_BOT_TOKEN"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "telegram-sender", name: "Telegram Sender", description: "Send messages, photos, and documents to Telegram chats and channels.", category: "Communication", tags: ["telegram", "messaging", "bots"], emoji: "✈️", requiredBins: [], requiredEnvVars: ["TELEGRAM_BOT_TOKEN"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "twilio-sms", name: "Twilio SMS", description: "Send and receive SMS messages, verify phone numbers, and manage conversations.", category: "Communication", tags: ["twilio", "sms", "phone"], emoji: "📱", requiredBins: [], requiredEnvVars: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "whatsapp-sender", name: "WhatsApp Sender", description: "Send WhatsApp messages via Twilio or Meta Business API with templates.", category: "Communication", tags: ["whatsapp", "messaging", "business"], emoji: "💚", requiredBins: [], requiredEnvVars: ["WHATSAPP_TOKEN"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "teams-connector", name: "Teams Connector", description: "Post messages, manage teams, and handle notifications in Microsoft Teams.", category: "Communication", tags: ["teams", "microsoft", "enterprise"], emoji: "🟦", requiredBins: [], requiredEnvVars: ["TEAMS_WEBHOOK_URL"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "pushover-notify", name: "Pushover Notify", description: "Send push notifications to mobile devices with priority levels and sounds.", category: "Communication", tags: ["pushover", "notifications", "mobile"], emoji: "🔔", requiredBins: [], requiredEnvVars: ["PUSHOVER_TOKEN", "PUSHOVER_USER"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "webhook-sender", name: "Webhook Sender", description: "Send webhook payloads to any URL with custom headers, retries, and signing.", category: "Communication", tags: ["webhooks", "http", "integration"], emoji: "🪝", requiredBins: [], requiredEnvVars: [], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "translation-api", name: "Translation API", description: "Translate text between 100+ languages using DeepL or Google Translate.", category: "Communication", tags: ["translation", "languages", "i18n"], emoji: "🌐", requiredBins: [], requiredEnvVars: ["DEEPL_API_KEY"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "intercom-chat", name: "Intercom Chat", description: "Manage Intercom conversations, contacts, and help center articles.", category: "Communication", tags: ["intercom", "support", "chat"], emoji: "💁", requiredBins: [], requiredEnvVars: ["INTERCOM_ACCESS_TOKEN"], isFree: true, price: null, trustTier: "SCANNED" },
]

// ─── Marketing (10 skills) ───────────────────────────────
const MARKETING: MarketplaceSkillSeed[] = [
  { slug: "dall-e-generator", name: "DALL-E Generator", description: "Generate images from text prompts using OpenAI DALL-E with size and style options.", category: "Marketing", tags: ["dalle", "image-gen", "ai-art"], emoji: "🎨", requiredBins: [], requiredEnvVars: ["OPENAI_API_KEY"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "stable-diffusion", name: "Stable Diffusion", description: "Generate and edit images with Stable Diffusion models via API.", category: "Marketing", tags: ["stable-diffusion", "image-gen", "open-source"], emoji: "🖼️", requiredBins: [], requiredEnvVars: ["STABILITY_API_KEY"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "seo-content-writer", name: "SEO Content Writer", description: "Generate SEO-optimized articles with keyword density, headings, and meta descriptions.", category: "Marketing", tags: ["seo", "writing", "articles"], emoji: "✏️", requiredBins: [], requiredEnvVars: [], isFree: false, price: 9, trustTier: "SCANNED" },
  { slug: "wordpress-cms", name: "WordPress CMS", description: "Create, edit, and manage WordPress posts, pages, and media via REST API.", category: "Marketing", tags: ["wordpress", "cms", "blog"], emoji: "📰", requiredBins: [], requiredEnvVars: ["WORDPRESS_URL", "WORDPRESS_TOKEN"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "beehiiv-newsletter", name: "Beehiiv Newsletter", description: "Create and send newsletters, manage subscribers, and track opens via Beehiiv.", category: "Marketing", tags: ["beehiiv", "newsletter", "email"], emoji: "🐝", requiredBins: [], requiredEnvVars: ["BEEHIIV_API_KEY"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "substack-newsletter", name: "Substack Newsletter", description: "Publish posts, manage paid subscriptions, and export subscriber data.", category: "Marketing", tags: ["substack", "newsletter", "subscriptions"], emoji: "📰", requiredBins: [], requiredEnvVars: ["SUBSTACK_API_KEY"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "whisper-transcriber", name: "Whisper Transcriber", description: "Transcribe audio and video to text using OpenAI Whisper with timestamp support.", category: "Marketing", tags: ["whisper", "transcription", "audio"], emoji: "🎤", requiredBins: ["ffmpeg"], requiredEnvVars: ["OPENAI_API_KEY"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "text-to-speech", name: "Text to Speech", description: "Convert text to natural-sounding audio using OpenAI TTS or ElevenLabs.", category: "Marketing", tags: ["tts", "audio", "voice"], emoji: "🔊", requiredBins: [], requiredEnvVars: ["OPENAI_API_KEY"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "image-resizer", name: "Image Resizer", description: "Resize, crop, compress, and convert images between formats.", category: "Marketing", tags: ["images", "resize", "optimization"], emoji: "🖼️", requiredBins: [], requiredEnvVars: [], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "mailchimp-campaigns", name: "Mailchimp Campaigns", description: "Create, send, and analyze email campaigns and automations in Mailchimp.", category: "Marketing", tags: ["mailchimp", "campaigns", "marketing"], emoji: "🐵", requiredBins: [], requiredEnvVars: ["MAILCHIMP_API_KEY"], isFree: true, price: null, trustTier: "SCANNED" },
]

// ─── Data (10 skills) ────────────────────────────────────
const DATA: MarketplaceSkillSeed[] = [
  { slug: "json-transformer", name: "JSON Transformer", description: "Parse, query, transform, and validate JSON data using JSONPath and schema validation.", category: "Data", tags: ["json", "data", "transform"], emoji: "📋", requiredBins: [], requiredEnvVars: [], isFree: true, price: null, trustTier: "OFFICIAL" },
  { slug: "csv-parser", name: "CSV Parser", description: "Parse, filter, sort, and transform CSV files with column mapping and data type inference.", category: "Data", tags: ["csv", "data", "parsing"], emoji: "📊", requiredBins: [], requiredEnvVars: [], isFree: true, price: null, trustTier: "OFFICIAL" },
  { slug: "google-analytics", name: "Google Analytics", description: "Query GA4 reports, track events, and analyze website traffic patterns.", category: "Data", tags: ["google", "ga4", "traffic"], emoji: "📈", requiredBins: [], requiredEnvVars: ["GA_PROPERTY_ID", "GA_CREDENTIALS"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "mixpanel-events", name: "Mixpanel Events", description: "Track product events, build funnels, and analyze user retention in Mixpanel.", category: "Data", tags: ["mixpanel", "product", "funnels"], emoji: "🔬", requiredBins: [], requiredEnvVars: ["MIXPANEL_TOKEN"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "posthog-analytics", name: "PostHog Analytics", description: "Open-source product analytics with feature flags, session replay, and A/B tests.", category: "Data", tags: ["posthog", "open-source", "experiments"], emoji: "🦔", requiredBins: [], requiredEnvVars: ["POSTHOG_API_KEY"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "plausible-analytics", name: "Plausible Analytics", description: "Privacy-friendly, lightweight web analytics without cookies.", category: "Data", tags: ["plausible", "privacy", "lightweight"], emoji: "🌱", requiredBins: [], requiredEnvVars: ["PLAUSIBLE_API_KEY"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "ahrefs-seo", name: "Ahrefs SEO", description: "Research keywords, analyze backlinks, audit sites, and track rankings.", category: "Data", tags: ["ahrefs", "seo", "backlinks"], emoji: "🔗", requiredBins: [], requiredEnvVars: ["AHREFS_API_KEY"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "data-visualizer", name: "Data Visualizer", description: "Generate charts, graphs, and dashboards from structured data using Vega-Lite.", category: "Data", tags: ["charts", "visualization", "dashboards"], emoji: "📉", requiredBins: [], requiredEnvVars: [], isFree: false, price: 9, trustTier: "SCANNED" },
  { slug: "ab-test-analyzer", name: "A/B Test Analyzer", description: "Calculate statistical significance, confidence intervals, and sample sizes for experiments.", category: "Data", tags: ["ab-testing", "statistics", "experiments"], emoji: "🧪", requiredBins: [], requiredEnvVars: [], isFree: false, price: 7, trustTier: "SCANNED" },
  { slug: "google-search-console", name: "Google Search Console", description: "Monitor search performance, indexing status, and keyword rankings.", category: "Data", tags: ["google", "seo", "search"], emoji: "🔎", requiredBins: [], requiredEnvVars: ["GSC_CREDENTIALS"], isFree: true, price: null, trustTier: "SCANNED" },
]

// ─── CRM (10 skills) ─────────────────────────────────────
const CRM: MarketplaceSkillSeed[] = [
  { slug: "hubspot-crm", name: "HubSpot CRM", description: "Manage contacts, deals, companies, and pipelines in HubSpot with full CRUD operations.", category: "CRM", tags: ["hubspot", "sales", "contacts"], emoji: "🟠", requiredBins: [], requiredEnvVars: ["HUBSPOT_API_KEY"], isFree: true, price: null, trustTier: "OFFICIAL" },
  { slug: "salesforce-crm", name: "Salesforce CRM", description: "Query and update Salesforce objects, run reports, and manage opportunities.", category: "CRM", tags: ["salesforce", "enterprise", "sales"], emoji: "☁️", requiredBins: [], requiredEnvVars: ["SALESFORCE_TOKEN"], isFree: true, price: null, trustTier: "OFFICIAL" },
  { slug: "pipedrive-crm", name: "Pipedrive CRM", description: "Manage deals, contacts, activities, and pipeline stages in Pipedrive.", category: "CRM", tags: ["pipedrive", "deals", "pipeline"], emoji: "🟢", requiredBins: [], requiredEnvVars: ["PIPEDRIVE_API_TOKEN"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "apollo-prospecting", name: "Apollo Prospecting", description: "Search, enrich, and export leads from Apollo's B2B contact database.", category: "CRM", tags: ["apollo", "leads", "prospecting"], emoji: "🚀", requiredBins: [], requiredEnvVars: ["APOLLO_API_KEY"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "clay-enrichment", name: "Clay Enrichment", description: "Enrich contact and company data using Clay's waterfall enrichment engine.", category: "CRM", tags: ["clay", "enrichment", "data"], emoji: "🏺", requiredBins: [], requiredEnvVars: ["CLAY_API_KEY"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "close-crm", name: "Close CRM", description: "Manage leads, opportunities, and email sequences in Close CRM.", category: "CRM", tags: ["close", "sales", "outbound"], emoji: "📞", requiredBins: [], requiredEnvVars: ["CLOSE_API_KEY"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "freshsales-crm", name: "Freshsales CRM", description: "AI-powered CRM with lead scoring, deal management, and built-in phone/email.", category: "CRM", tags: ["freshsales", "ai", "scoring"], emoji: "🍊", requiredBins: [], requiredEnvVars: ["FRESHSALES_API_KEY"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "lead-scoring-engine", name: "Lead Scoring Engine", description: "Score leads based on firmographic, behavioral, and engagement signals with configurable weights.", category: "CRM", tags: ["scoring", "qualification", "leads"], emoji: "📈", requiredBins: [], requiredEnvVars: [], isFree: false, price: 9, trustTier: "SCANNED" },
  { slug: "crm-data-sync", name: "CRM Data Sync", description: "Bi-directional sync between multiple CRM platforms with conflict resolution.", category: "CRM", tags: ["sync", "integration", "migration"], emoji: "🔄", requiredBins: [], requiredEnvVars: [], isFree: false, price: 14, trustTier: "SCANNED" },
  { slug: "copper-crm", name: "Copper CRM", description: "Google Workspace-native CRM for contacts, deals, and relationship tracking.", category: "CRM", tags: ["copper", "google", "relationships"], emoji: "🔶", requiredBins: [], requiredEnvVars: ["COPPER_API_KEY"], isFree: true, price: null, trustTier: "SCANNED" },
]

// ─── Email (9 skills) ────────────────────────────────────
const EMAIL: MarketplaceSkillSeed[] = [
  { slug: "resend-mailer", name: "Resend Mailer", description: "Send transactional and marketing emails via Resend with template support.", category: "Email", tags: ["resend", "email", "transactional"], emoji: "📨", requiredBins: [], requiredEnvVars: ["RESEND_API_KEY"], isFree: true, price: null, trustTier: "OFFICIAL" },
  { slug: "sendgrid-sender", name: "SendGrid Sender", description: "Send emails at scale via SendGrid with dynamic templates and analytics.", category: "Email", tags: ["sendgrid", "email", "templates"], emoji: "📧", requiredBins: [], requiredEnvVars: ["SENDGRID_API_KEY"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "instantly-outreach", name: "Instantly Outreach", description: "Manage cold email campaigns with warm-up, sequencing, and A/B testing.", category: "Email", tags: ["instantly", "cold-email", "outreach"], emoji: "⚡", requiredBins: [], requiredEnvVars: ["INSTANTLY_API_KEY"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "smartlead-outreach", name: "SmartLead Outreach", description: "Multi-channel cold email campaigns with unlimited sender accounts.", category: "Email", tags: ["smartlead", "cold-email", "multichannel"], emoji: "🎯", requiredBins: [], requiredEnvVars: ["SMARTLEAD_API_KEY"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "imap-reader", name: "IMAP Reader", description: "Read, search, and process emails from any IMAP-compatible inbox.", category: "Email", tags: ["imap", "inbox", "reading"], emoji: "📬", requiredBins: [], requiredEnvVars: ["IMAP_HOST", "IMAP_USER", "IMAP_PASS"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "email-parser", name: "Email Parser", description: "Extract structured data from emails: sender, subject, body text, attachments, and links.", category: "Email", tags: ["parsing", "extraction", "email"], emoji: "🔍", requiredBins: [], requiredEnvVars: [], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "email-template-engine", name: "Email Template Engine", description: "Render dynamic email templates with Handlebars variables and conditional blocks.", category: "Email", tags: ["templates", "rendering", "handlebars"], emoji: "🎨", requiredBins: [], requiredEnvVars: [], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "bounce-handler", name: "Bounce Handler", description: "Process email bounces, categorize failure types, and clean mailing lists.", category: "Email", tags: ["bounces", "deliverability", "cleanup"], emoji: "↩️", requiredBins: [], requiredEnvVars: [], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "screenshot-capture", name: "Screenshot Capture", description: "Capture full-page or element-level screenshots of web pages for email previews.", category: "Email", tags: ["screenshots", "web", "capture"], emoji: "📸", requiredBins: [], requiredEnvVars: [], isFree: true, price: null, trustTier: "SCANNED" },
]

// ─── Finance (14 skills) ─────────────────────────────────
const FINANCE: MarketplaceSkillSeed[] = [
  { slug: "stripe-payments", name: "Stripe Payments", description: "Create charges, manage subscriptions, issue refunds, and query payment data.", category: "Finance", tags: ["stripe", "payments", "subscriptions"], emoji: "💳", requiredBins: [], requiredEnvVars: ["STRIPE_SECRET_KEY"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "quickbooks-sync", name: "QuickBooks Sync", description: "Sync invoices, expenses, and financial reports with QuickBooks Online.", category: "Finance", tags: ["quickbooks", "accounting", "invoicing"], emoji: "📗", requiredBins: [], requiredEnvVars: ["QUICKBOOKS_CLIENT_ID"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "invoice-generator", name: "Invoice Generator", description: "Generate professional PDF invoices from structured data with line items and tax.", category: "Finance", tags: ["invoices", "pdf", "billing"], emoji: "🧾", requiredBins: [], requiredEnvVars: [], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "expense-tracker", name: "Expense Tracker", description: "Categorize expenses, track budgets, and generate monthly spending reports.", category: "Finance", tags: ["expenses", "budgets", "tracking"], emoji: "💰", requiredBins: [], requiredEnvVars: [], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "paypal-manager", name: "PayPal Manager", description: "Process PayPal payments, manage disputes, and query transaction history.", category: "Finance", tags: ["paypal", "payments", "disputes"], emoji: "🅿️", requiredBins: [], requiredEnvVars: ["PAYPAL_CLIENT_ID", "PAYPAL_SECRET"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "crypto-tracker", name: "Crypto Tracker", description: "Track cryptocurrency portfolios, prices, and market data across exchanges.", category: "Finance", tags: ["crypto", "portfolio", "markets"], emoji: "₿", requiredBins: [], requiredEnvVars: [], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "currency-converter", name: "Currency Converter", description: "Real-time currency conversion with historical rates and batch processing.", category: "Finance", tags: ["currency", "forex", "conversion"], emoji: "💱", requiredBins: [], requiredEnvVars: [], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "financial-calculator", name: "Financial Calculator", description: "Compound interest, loan amortization, ROI, and financial modeling calculations.", category: "Finance", tags: ["calculator", "roi", "modeling"], emoji: "🔢", requiredBins: [], requiredEnvVars: [], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "binance-trading", name: "Binance Trading", description: "Place orders, check balances, and monitor positions on Binance exchange.", category: "Finance", tags: ["binance", "crypto", "exchange"], emoji: "🟡", requiredBins: [], requiredEnvVars: ["BINANCE_API_KEY", "BINANCE_SECRET"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "coinbase-trading", name: "Coinbase Trading", description: "Buy, sell, and manage crypto assets on Coinbase with portfolio tracking.", category: "Finance", tags: ["coinbase", "crypto", "portfolio"], emoji: "🔵", requiredBins: [], requiredEnvVars: ["COINBASE_API_KEY", "COINBASE_SECRET"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "alpaca-trading", name: "Alpaca Trading", description: "Commission-free stock and crypto trading with paper trading support.", category: "Finance", tags: ["alpaca", "stocks", "paper-trading"], emoji: "🦙", requiredBins: [], requiredEnvVars: ["ALPACA_API_KEY", "ALPACA_SECRET"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "yahoo-finance", name: "Yahoo Finance", description: "Fetch stock quotes, historical data, financial statements, and news.", category: "Finance", tags: ["yahoo", "stocks", "fundamentals"], emoji: "📈", requiredBins: [], requiredEnvVars: [], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "trading-signals", name: "Trading Signals", description: "Technical analysis with RSI, MACD, Bollinger Bands, and custom indicator support.", category: "Finance", tags: ["signals", "technical-analysis", "indicators"], emoji: "📡", requiredBins: [], requiredEnvVars: [], isFree: false, price: 14, trustTier: "SCANNED" },
  { slug: "polymarket-predictions", name: "Polymarket Predictions", description: "Browse, analyze, and track prediction markets on Polymarket.", category: "Finance", tags: ["polymarket", "predictions", "markets"], emoji: "🎲", requiredBins: [], requiredEnvVars: ["POLYMARKET_API_KEY"], isFree: true, price: null, trustTier: "SCANNED" },
]

// ─── Security (8 skills) ─────────────────────────────────
const SECURITY: MarketplaceSkillSeed[] = [
  { slug: "password-generator", name: "Password Generator", description: "Generate cryptographically secure passwords, passphrases, and API keys.", category: "Security", tags: ["passwords", "crypto", "generation"], emoji: "🔐", requiredBins: [], requiredEnvVars: [], isFree: true, price: null, trustTier: "OFFICIAL" },
  { slug: "vault-secrets", name: "Vault Secrets", description: "Read and write secrets in HashiCorp Vault with lease management.", category: "Security", tags: ["vault", "secrets", "hashicorp"], emoji: "🔒", requiredBins: ["vault"], requiredEnvVars: ["VAULT_ADDR", "VAULT_TOKEN"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "ssl-checker", name: "SSL Checker", description: "Verify SSL certificates, check expiry dates, and detect misconfigurations.", category: "Security", tags: ["ssl", "certificates", "tls"], emoji: "🔏", requiredBins: [], requiredEnvVars: [], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "owasp-checker", name: "OWASP Checker", description: "Scan web applications for OWASP Top 10 vulnerabilities with remediation guidance.", category: "Security", tags: ["owasp", "web-security", "scanning"], emoji: "🕷️", requiredBins: [], requiredEnvVars: [], isFree: false, price: 14, trustTier: "SCANNED" },
  { slug: "compliance-auditor", name: "Compliance Auditor", description: "Check infrastructure and code against SOC2, HIPAA, GDPR, and PCI-DSS requirements.", category: "Security", tags: ["compliance", "audit", "regulations"], emoji: "📋", requiredBins: [], requiredEnvVars: [], isFree: false, price: 19, trustTier: "SCANNED" },
  { slug: "secret-scanner", name: "Secret Scanner", description: "Scan codebases for accidentally committed secrets, tokens, and credentials.", category: "Security", tags: ["secrets", "detection", "leaks"], emoji: "🔦", requiredBins: [], requiredEnvVars: [], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "jwt-toolkit", name: "JWT Toolkit", description: "Decode, verify, create, and debug JSON Web Tokens with algorithm support.", category: "Security", tags: ["jwt", "tokens", "authentication"], emoji: "🎫", requiredBins: [], requiredEnvVars: [], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "http-client", name: "HTTP Client", description: "Make HTTP requests with custom headers, auth, retries, and response parsing.", category: "Security", tags: ["http", "api", "rest"], emoji: "🌐", requiredBins: [], requiredEnvVars: [], isFree: true, price: null, trustTier: "OFFICIAL" },
]

// ─── Social (10 skills) ──────────────────────────────────
const SOCIAL: MarketplaceSkillSeed[] = [
  { slug: "twitter-api", name: "Twitter/X API", description: "Post tweets, read timelines, manage followers, and track mentions on Twitter/X.", category: "Social", tags: ["twitter", "x", "social"], emoji: "🐦", requiredBins: [], requiredEnvVars: ["TWITTER_BEARER_TOKEN"], isFree: true, price: null, trustTier: "OFFICIAL" },
  { slug: "linkedin-api", name: "LinkedIn API", description: "Manage LinkedIn profiles, posts, connections, and company pages.", category: "Social", tags: ["linkedin", "professional", "networking"], emoji: "💼", requiredBins: [], requiredEnvVars: ["LINKEDIN_ACCESS_TOKEN"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "buffer-scheduler", name: "Buffer Scheduler", description: "Schedule and publish social media posts across multiple platforms via Buffer.", category: "Social", tags: ["buffer", "scheduling", "social"], emoji: "📅", requiredBins: [], requiredEnvVars: ["BUFFER_ACCESS_TOKEN"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "typefully-writer", name: "Typefully Writer", description: "Draft, schedule, and publish Twitter threads and posts with analytics.", category: "Social", tags: ["typefully", "threads", "writing"], emoji: "✍️", requiredBins: [], requiredEnvVars: ["TYPEFULLY_API_KEY"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "youtube-data-api", name: "YouTube Data API", description: "Search videos, manage playlists, read analytics, and post comments on YouTube.", category: "Social", tags: ["youtube", "video", "platform"], emoji: "▶️", requiredBins: [], requiredEnvVars: ["YOUTUBE_API_KEY"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "instagram-api", name: "Instagram API", description: "Post photos, stories, manage comments, and track engagement on Instagram.", category: "Social", tags: ["instagram", "photos", "stories"], emoji: "📸", requiredBins: [], requiredEnvVars: ["INSTAGRAM_ACCESS_TOKEN"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "tiktok-api", name: "TikTok API", description: "Upload videos, track analytics, and manage TikTok creator account content.", category: "Social", tags: ["tiktok", "video", "short-form"], emoji: "🎵", requiredBins: [], requiredEnvVars: ["TIKTOK_ACCESS_TOKEN"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "reddit-api", name: "Reddit API", description: "Browse subreddits, post content, track discussions, and monitor mentions.", category: "Social", tags: ["reddit", "communities", "discussions"], emoji: "🤖", requiredBins: [], requiredEnvVars: ["REDDIT_CLIENT_ID", "REDDIT_CLIENT_SECRET"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "mastodon-api", name: "Mastodon API", description: "Post toots, follow users, and interact with the Mastodon/Fediverse network.", category: "Social", tags: ["mastodon", "fediverse", "decentralized"], emoji: "🐘", requiredBins: [], requiredEnvVars: ["MASTODON_ACCESS_TOKEN"], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "social-analytics", name: "Social Analytics", description: "Aggregate engagement metrics across Twitter, LinkedIn, Instagram, and YouTube.", category: "Social", tags: ["analytics", "engagement", "metrics"], emoji: "📊", requiredBins: [], requiredEnvVars: [], isFree: false, price: 9, trustTier: "SCANNED" },
]

// ─── Web (7 skills) ──────────────────────────────────────
const WEB: MarketplaceSkillSeed[] = [
  { slug: "puppeteer-browser", name: "Puppeteer Browser", description: "Automate Chrome with page navigation, form filling, and data extraction.", category: "Web", tags: ["puppeteer", "chrome", "automation"], emoji: "🤖", requiredBins: [], requiredEnvVars: [], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "playwright-automation", name: "Playwright Automation", description: "Cross-browser testing and automation with Chromium, Firefox, and WebKit.", category: "Web", tags: ["playwright", "testing", "cross-browser"], emoji: "🎭", requiredBins: [], requiredEnvVars: [], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "lighthouse-audit", name: "Lighthouse Audit", description: "Run performance, accessibility, SEO, and best practices audits on any URL.", category: "Web", tags: ["lighthouse", "performance", "audit"], emoji: "🏠", requiredBins: [], requiredEnvVars: [], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "uptime-monitor", name: "Uptime Monitor", description: "Monitor website availability with HTTP checks, response time, and alerting.", category: "Web", tags: ["uptime", "monitoring", "alerts"], emoji: "📡", requiredBins: [], requiredEnvVars: [], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "sitemap-generator", name: "Sitemap Generator", description: "Crawl websites and generate XML sitemaps with priority and change frequency.", category: "Web", tags: ["sitemap", "seo", "crawling"], emoji: "🗺️", requiredBins: [], requiredEnvVars: [], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "web-scraper", name: "Web Scraper", description: "Extract structured data from web pages using CSS selectors and XPath.", category: "Web", tags: ["scraping", "extraction", "parsing"], emoji: "🕸️", requiredBins: [], requiredEnvVars: [], isFree: true, price: null, trustTier: "SCANNED" },
  { slug: "cors-proxy", name: "CORS Proxy", description: "Proxy HTTP requests to bypass CORS restrictions for client-side API access.", category: "Web", tags: ["cors", "proxy", "api"], emoji: "🔀", requiredBins: [], requiredEnvVars: [], isFree: true, price: null, trustTier: "SCANNED" },
]

// ─── PDF & Docs (in Data) ────────────────────────────────
const PDF_DOCS: MarketplaceSkillSeed[] = [
  { slug: "pdf-reader", name: "PDF Reader", description: "Extract text, tables, and metadata from PDF documents with page-level granularity.", category: "Data", tags: ["pdf", "documents", "extraction"], emoji: "📄", requiredBins: [], requiredEnvVars: [], isFree: true, price: null, trustTier: "OFFICIAL" },
  { slug: "markdown-converter", name: "Markdown Converter", description: "Convert between Markdown, HTML, plain text, and structured document formats.", category: "Data", tags: ["markdown", "conversion", "formatting"], emoji: "📝", requiredBins: [], requiredEnvVars: [], isFree: true, price: null, trustTier: "OFFICIAL" },
]

export const MARKETPLACE_SKILLS_CATALOG: MarketplaceSkillSeed[] = [
  ...DEVELOPER,
  ...SYSTEM,
  ...PRODUCTIVITY,
  ...SEARCH,
  ...COMMUNICATION,
  ...MARKETING,
  ...DATA,
  ...CRM,
  ...EMAIL,
  ...FINANCE,
  ...SECURITY,
  ...SOCIAL,
  ...WEB,
  ...PDF_DOCS,
]

const slugs = MARKETPLACE_SKILLS_CATALOG.map((s) => s.slug)
if (new Set(slugs).size !== slugs.length) {
  const dupes = slugs.filter((s, i) => slugs.indexOf(s) !== i)
  throw new Error(`Duplicate marketplace skill slugs: ${dupes.join(", ")}`)
}
