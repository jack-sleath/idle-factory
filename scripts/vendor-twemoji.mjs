// Vendors the Twemoji 14.0.2 SVGs the app uses into `public/twemoji/`, so they
// are committed to the repo and precached by the service worker for offline
// use. Fetches from the version-pinned CDN (the npm `twemoji` package no longer
// ships the raw SVG assets). Re-run whenever the emoji set changes; the
// committed files are what the app and offline cache actually rely on.
//
// The filename logic mirrors src/lib/twemoji.ts so the copied files match the
// URLs the app requests at runtime.
import path from 'node:path'
import fs from 'node:fs'

const ZWJ = '‍'
const VARIATION_SELECTOR_16 = /️/g

function toCodePoint(str, sep = '-') {
  const out = []
  let high = 0
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i)
    if (high) {
      out.push((0x10000 + ((high - 0xd800) << 10) + (c - 0xdc00)).toString(16))
      high = 0
    } else if (c >= 0xd800 && c <= 0xdbff) {
      high = c
    } else {
      out.push(c.toString(16))
    }
  }
  return out.join(sep)
}

function emojiToCodePoint(emoji) {
  const normalized = emoji.indexOf(ZWJ) < 0 ? emoji.replace(VARIATION_SELECTOR_16, '') : emoji
  return toCodePoint(normalized)
}

const TWEMOJI_VERSION = '14.0.2'
// Version-pinned SVG sources (maintained fork first, original as fallback).
const CDN_BASES = [
  `https://cdn.jsdelivr.net/gh/jdecked/twemoji@${TWEMOJI_VERSION}/assets/svg`,
  `https://cdn.jsdelivr.net/gh/twitter/twemoji@${TWEMOJI_VERSION}/assets/svg`,
]

// The emoji currently rendered anywhere in the app (world sprites + UI chrome).
const EMOJI = ['⛏️', '➡️', '📦', '🪨', '🐄', '🥛', '🏭']

async function fetchSvg(cp) {
  for (const base of CDN_BASES) {
    const url = `${base}/${cp}.svg`
    try {
      const res = await fetch(url)
      if (res.ok) return await res.text()
    } catch {
      // try next source
    }
  }
  return null
}

const outDir = path.join(process.cwd(), 'public', 'twemoji')
fs.mkdirSync(outDir, { recursive: true })

let failed = 0
for (const emoji of EMOJI) {
  const cp = emojiToCodePoint(emoji)
  const svg = await fetchSvg(cp)
  if (svg == null) {
    console.error(`  MISSING: ${emoji} (${cp}.svg) could not be fetched`)
    failed++
    continue
  }
  fs.writeFileSync(path.join(outDir, `${cp}.svg`), svg)
  console.log(`  vendored ${emoji} -> twemoji/${cp}.svg`)
}

if (failed > 0) {
  console.error(`\n${failed} emoji could not be vendored.`)
  process.exit(1)
}
console.log(`\nVendored ${EMOJI.length} Twemoji ${TWEMOJI_VERSION} SVGs into public/twemoji/.`)
