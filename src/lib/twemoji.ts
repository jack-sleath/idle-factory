// Maps an emoji string to its vendored Twemoji 14.0.2 SVG asset URL.
//
// The filename is the emoji's Unicode code point(s) in lowercase hex, joined
// by '-'. This mirrors Twemoji's own `toCodePoint`/`grabTheRightIcon` logic so
// that the names we compute match the files that ship in `public/twemoji/`:
// the variation selector U+FE0F is stripped *unless* the sequence contains a
// zero-width joiner (U+200D), in which case it is preserved.

const ZWJ = '‍'
const VARIATION_SELECTOR_16 = /️/g

/** Convert a (possibly multi-code-point) string to Twemoji's dashed hex form. */
export function toCodePoint(unicodeSurrogates: string, sep = '-'): string {
  const out: string[] = []
  let highSurrogate = 0
  for (let i = 0; i < unicodeSurrogates.length; i++) {
    const c = unicodeSurrogates.charCodeAt(i)
    if (highSurrogate) {
      out.push((0x10000 + ((highSurrogate - 0xd800) << 10) + (c - 0xdc00)).toString(16))
      highSurrogate = 0
    } else if (c >= 0xd800 && c <= 0xdbff) {
      highSurrogate = c
    } else {
      out.push(c.toString(16))
    }
  }
  return out.join(sep)
}

/** Twemoji codepoint filename (without extension) for an emoji. */
export function emojiToCodePoint(emoji: string): string {
  const normalized = emoji.indexOf(ZWJ) < 0 ? emoji.replace(VARIATION_SELECTOR_16, '') : emoji
  return toCodePoint(normalized)
}

/** Absolute URL (respecting the app base path) of an emoji's vendored SVG. */
export function twemojiUrl(emoji: string): string {
  // BASE_URL always ends with '/', e.g. '/idle-factory/'.
  return `${import.meta.env.BASE_URL}twemoji/${emojiToCodePoint(emoji)}.svg`
}
