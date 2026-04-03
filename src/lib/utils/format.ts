export function formatCurrency(amount: number): string {
  return "$" + amount.toFixed(2);
}

export function formatCurrencyRounded(amount: number): string {
  return "$" + Math.round(amount).toLocaleString();
}

const MODEL_DISPLAY_NAMES: Record<string, string> = {
  "HAIKU_4_5": "Claude Haiku 4.5",
  "SONNET_4_6": "Claude Sonnet 4.6",
  "OPUS_4_6": "Claude Opus 4.6",
  "GPT_4O": "GPT-4o",
  "GEMINI_2_5_PRO": "Gemini 2.5 Pro",
  "claude-haiku-4-5": "Claude Haiku 4.5",
  "claude-sonnet-4-6": "Claude Sonnet 4.6",
  "claude-opus-4-6": "Claude Opus 4.6",
}

export function getModelDisplayName(model: string): string {
  if (MODEL_DISPLAY_NAMES[model]) return MODEL_DISPLAY_NAMES[model]

  const withoutProvider = model.replace(/^(anthropic|openai|google)\//, "")
  if (MODEL_DISPLAY_NAMES[withoutProvider]) return MODEL_DISPLAY_NAMES[withoutProvider]

  for (const [key, display] of Object.entries(MODEL_DISPLAY_NAMES)) {
    if (withoutProvider.startsWith(key)) return display
  }

  const lower = model.toLowerCase()
  if (lower.includes("opus")) return "Claude Opus 4.6"
  if (lower.includes("haiku")) return "Claude Haiku 4.5"
  if (lower.includes("sonnet")) return "Claude Sonnet 4.6"

  return withoutProvider || model
}
