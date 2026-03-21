import { SeedSkill } from "./types"

export const BUILTIN_SKILLS: SeedSkill[] = [
  {
    name: "Web Search",
    slug: "web-search",
    description: "Search the web for current information",
    skillMd: `## Web Search

Built-in search powered by **Tavily** for up-to-date results.

Use when you need facts, news, documentation, or anything not in the model's cutoff.

Keep queries focused; cite sources when summarizing.`,
    type: "BUILT_IN",
    category: "SEARCH",
    icon: "🔍",
    compatibleTools: ["*"],
    requiresToolConnection: false,
    isBuiltIn: true,
    permissions: ["internet_access"],
  },
  {
    name: "File System",
    slug: "filesystem",
    description: "Read, write, and list files in the workspace",
    skillMd: `## File System

Read, write, and list files within the agent workspace.

Use for configs, logs, artifacts, and structured project files.

Prefer small, targeted edits; avoid overwriting without intent.`,
    type: "BUILT_IN",
    category: "CORE",
    icon: "📁",
    compatibleTools: ["*"],
    requiresToolConnection: false,
    isBuiltIn: true,
    permissions: ["file_read", "file_write"],
  },
  {
    name: "Shell Commands",
    slug: "shell",
    description:
      "Execute shell commands; bash, curl, jq, node, and python3 are available",
    skillMd: `## Shell Commands

Run shell commands in a controlled environment.

**Available:** bash, curl, jq, node, python3.

Use for scripting, one-off utilities, and piping data between tools.`,
    type: "BUILT_IN",
    category: "CORE",
    icon: "⚡",
    compatibleTools: ["*"],
    requiresToolConnection: false,
    isBuiltIn: true,
    permissions: ["shell_access"],
  },
  {
    name: "Memory",
    slug: "memory",
    description: "Persistent memory via MEMORY.md and daily logs",
    skillMd: `## Memory

Persist context across sessions using **MEMORY.md** and daily log files.

Use for preferences, decisions, and ongoing task state.

Keep entries concise and structured for easy retrieval.`,
    type: "BUILT_IN",
    category: "CORE",
    icon: "🧠",
    compatibleTools: ["*"],
    requiresToolConnection: false,
    isBuiltIn: true,
    permissions: ["file_read", "file_write"],
  },
  {
    name: "Browser",
    slug: "browser",
    description: "Browse web pages and extract content",
    skillMd: `## Browser

Open URLs and extract readable content from pages.

Use for pages that need rendering or deep extraction beyond search snippets.

Respect robots and site terms; prefer official APIs when available.`,
    type: "BUILT_IN",
    category: "CORE",
    icon: "🌐",
    compatibleTools: ["*"],
    requiresToolConnection: false,
    isBuiltIn: true,
    permissions: ["internet_access"],
  },
  {
    name: "GitHub",
    slug: "github",
    description: "Work with issues, PRs, CI status, and commits",
    skillMd: `## GitHub

Integrates with GitHub for issues, pull requests, CI status, and commits.

Connect the GitHub tool when org/repo access is required.

Use for code review workflows and release tracking.`,
    type: "BUILT_IN",
    category: "CORE",
    icon: "🐙",
    compatibleTools: ["github"],
    requiresToolConnection: false,
    isBuiltIn: true,
    permissions: ["internet_access"],
  },
  {
    name: "Calendar",
    slug: "calendar",
    description: "Check and manage calendar events",
    skillMd: `## Calendar

View and manage calendar events via **Google Calendar** when connected.

Use for scheduling, availability checks, and event updates.

Confirm timezone and attendee expectations before sending invites.`,
    type: "BUILT_IN",
    category: "CALENDAR",
    icon: "📅",
    compatibleTools: ["google-calendar"],
    requiresToolConnection: false,
    isBuiltIn: true,
    permissions: ["internet_access"],
  },
  {
    name: "Email Reader",
    slug: "email-reader",
    description: "Read and search the inbox",
    skillMd: `## Email Reader

Read and search inbox messages via **Gmail** when connected.

Use for triage, thread context, and finding specific correspondence.

Avoid quoting sensitive content unnecessarily in outputs.`,
    type: "BUILT_IN",
    category: "EMAIL_READER",
    icon: "📨",
    compatibleTools: ["gmail"],
    requiresToolConnection: false,
    isBuiltIn: true,
    permissions: ["internet_access"],
  },
  {
    name: "Email Sender",
    slug: "email-sender",
    description:
      "Send emails and manage drafts; first sends require approval",
    skillMd: `## Email Sender

Compose, send, and manage drafts through **Gmail** when connected.

**Note:** First sends may require explicit approval.

Use clear subjects and recipients; prefer drafts for sensitive first contact.`,
    type: "BUILT_IN",
    category: "EMAIL_SENDER",
    icon: "📤",
    compatibleTools: ["gmail"],
    requiresToolConnection: false,
    isBuiltIn: true,
    permissions: ["internet_access", "email_send"],
  },
  {
    name: "Data Analysis",
    slug: "data-analysis",
    description:
      "Parse CSV/JSON, calculate statistics, and generate reports",
    skillMd: `## Data Analysis

Parse **CSV** and **JSON**, compute statistics, and produce short reports.

Combines shell/file access for data loading and transformation.

Validate assumptions; note data quality and sample size in summaries.`,
    type: "BUILT_IN",
    category: "ANALYTICS",
    icon: "📊",
    compatibleTools: ["*"],
    requiresToolConnection: false,
    isBuiltIn: true,
    permissions: ["shell_access", "file_read"],
  },
]
