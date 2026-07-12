import { twemojiUrl } from '../lib/twemoji'

// Rasterizes vendored Twemoji SVGs into cached bitmaps for fast canvas drawing.
//
// Each emoji is rasterized once at a fixed high resolution; the renderer scales
// the cached bitmap down/up to the current zoom with drawImage. The source is
// intentionally abstracted behind `get(emoji)` so a real spritesheet can
// replace the SVG loader later without touching the renderer.

const RASTER_SIZE = 128

type Status = 'loading' | 'ready' | 'error'

interface Entry {
  status: Status
  bitmap?: HTMLCanvasElement
}

export class SpriteCache {
  private cache = new Map<string, Entry>()

  /**
   * Returns the cached bitmap for an emoji, or null if it is still loading or
   * failed. Kicks off the async load on first request; because the renderer
   * runs in a rAF loop, the sprite simply appears once the bitmap is ready.
   */
  get(emoji: string): HTMLCanvasElement | null {
    const existing = this.cache.get(emoji)
    if (existing) {
      return existing.status === 'ready' ? existing.bitmap ?? null : null
    }

    const entry: Entry = { status: 'loading' }
    this.cache.set(emoji, entry)

    const img = new Image()
    img.decoding = 'async'
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = RASTER_SIZE
      canvas.height = RASTER_SIZE
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.clearRect(0, 0, RASTER_SIZE, RASTER_SIZE)
        ctx.drawImage(img, 0, 0, RASTER_SIZE, RASTER_SIZE)
        entry.bitmap = canvas
        entry.status = 'ready'
      } else {
        entry.status = 'error'
      }
    }
    img.onerror = () => {
      entry.status = 'error'
    }
    img.src = twemojiUrl(emoji)

    return null
  }
}
