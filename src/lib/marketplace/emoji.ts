/**
 * Single-emoji validation for the skill-publish emoji field (taste batch,
 * 2026-08-25). The old guard was `emoji.length > 4`, which is wrong in both
 * directions: it ACCEPTS any short junk ("ab!?") and REJECTS legitimate
 * emoji whose UTF-16 length exceeds 4 (ZWJ families are 11 units, flags 4+VS,
 * skin-toned hands 4-7).
 *
 * `^\p{RGI_Emoji}$` with the `v` (unicodeSets) flag matches EXACTLY ONE
 * emoji sequence from the "recommended for general interchange" set: base
 * pictographs, VS16 forms, skin tones, ZWJ sequences, flags, keycaps. Two
 * emoji, letters, digits, or trailing spaces all fail the anchors.
 */

let rgiEmojiRe: RegExp | null | undefined

function getRgiEmojiRe(): RegExp | null {
  if (rgiEmojiRe !== undefined) return rgiEmojiRe
  try {
    // Constructed (not a literal) so TS targets below es2024 don't reject the
    // `v` flag at compile time. Node 20+ and 2023+ browsers support it.
    rgiEmojiRe = new RegExp(String.raw`^\p{RGI_Emoji}$`, "v")
  } catch {
    rgiEmojiRe = null
  }
  return rgiEmojiRe
}

/** Old-engine fallback: one grapheme-ish emoji cluster, no letters/digits. */
function isSingleEmojiFallback(value: string): boolean {
  const componentOnly = /^[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\u200D\uFE0F\u20E3]+$/u
  if (!componentOnly.test(value)) return false
  const hasCore =
    /\p{Extended_Pictographic}/u.test(value) ||
    (value.match(/\p{Regional_Indicator}/gu)?.length ?? 0) === 2
  if (!hasCore) return false
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const graphemes = [...new Intl.Segmenter().segment(value)]
    return graphemes.length === 1
  }
  return [...value].length <= 11
}

/** True when `value` is exactly one emoji (ZWJ/flag/keycap/skin-tone aware). */
export function isSingleEmoji(value: string): boolean {
  if (!value) return false
  const re = getRgiEmojiRe()
  if (re) return re.test(value)
  return isSingleEmojiFallback(value)
}
