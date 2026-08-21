/**
 * Per-agent thinking effort. Maps 1:1 to OpenClaw's `agents.list[].thinkingDefault`
 * (verified against runtime dist: levels off|minimal|low|medium|high; models
 * without reasoning support ignore the setting at run time).
 */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high"] as const

export type ThinkingLevel = (typeof THINKING_LEVELS)[number]

export const THINKING_LEVEL_LABEL: Record<ThinkingLevel, string> = {
  off: "Off",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
}

/** null/undefined = "Default": omit from config, runtime picks its own default. */
export function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === "string" && (THINKING_LEVELS as readonly string[]).includes(value)
}

export const THINKING_HELP_TEXT =
  "How much the model reasons before answering. Higher effort costs more tokens. Models without reasoning support ignore this."
