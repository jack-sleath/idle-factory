import { twemojiUrl } from '../lib/twemoji'

interface EmojiProps {
  /** The emoji character(s), e.g. "⛏️". */
  emoji: string
  /** Rendered size in pixels (square). Defaults to 20. */
  size?: number
  /** Accessible label; falls back to the emoji itself. */
  label?: string
  className?: string
}

/**
 * Renders a single emoji as a vendored Twemoji SVG `<img>`, for UI chrome
 * (buttons, HUD, panels). Grid/world sprites use the canvas pipeline instead.
 */
export function Emoji({ emoji, size = 20, label, className }: EmojiProps) {
  return (
    <img
      src={twemojiUrl(emoji)}
      alt={label ?? emoji}
      width={size}
      height={size}
      className={className}
      draggable={false}
      style={{ display: 'inline-block', verticalAlign: '-0.125em' }}
    />
  )
}
