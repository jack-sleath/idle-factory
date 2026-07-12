import { worldToScreen, screenToWorld, type Camera } from './camera'
import type { SpriteCache } from './sprites'

/** A single emoji sprite placed at an integer world cell. */
export interface Tile {
  cx: number
  cy: number
  emoji: string
}

const GRID_COLOR = 'rgba(255, 255, 255, 0.05)'
const BG_COLOR = '#141b22'

/**
 * Draws the visible scene: a faint grid plus every tile whose cell falls inside
 * the viewport (culling). Coordinates are in CSS pixels; the caller sets the
 * device-pixel-ratio transform on the context.
 */
export function renderScene(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  viewportW: number,
  viewportH: number,
  dpr: number,
  sprites: SpriteCache,
  tiles: Iterable<Tile>,
): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, viewportW, viewportH)
  ctx.fillStyle = BG_COLOR
  ctx.fillRect(0, 0, viewportW, viewportH)

  drawGrid(ctx, cam, viewportW, viewportH)

  const cell = cam.zoom
  const spriteSize = cell * 0.9

  for (const t of tiles) {
    const { sx, sy } = worldToScreen(cam, viewportW, viewportH, t.cx + 0.5, t.cy + 0.5)
    // Cull tiles fully outside the viewport (+1 cell margin).
    if (sx < -cell || sx > viewportW + cell || sy < -cell || sy > viewportH + cell) {
      continue
    }

    const bitmap = sprites.get(t.emoji)
    if (bitmap) {
      ctx.drawImage(bitmap, sx - spriteSize / 2, sy - spriteSize / 2, spriteSize, spriteSize)
    } else {
      // Placeholder while the sprite rasterizes.
      ctx.fillStyle = 'rgba(255,255,255,0.08)'
      ctx.fillRect(sx - spriteSize / 2, sy - spriteSize / 2, spriteSize, spriteSize)
    }
  }
}

/** Draws grid lines aligned to world cell boundaries across the viewport. */
function drawGrid(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  viewportW: number,
  viewportH: number,
): void {
  const topLeft = screenToWorld(cam, viewportW, viewportH, 0, 0)
  const bottomRight = screenToWorld(cam, viewportW, viewportH, viewportW, viewportH)

  const minX = Math.floor(topLeft.wx)
  const maxX = Math.ceil(bottomRight.wx)
  const minY = Math.floor(topLeft.wy)
  const maxY = Math.ceil(bottomRight.wy)

  ctx.strokeStyle = GRID_COLOR
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let x = minX; x <= maxX; x++) {
    const { sx } = worldToScreen(cam, viewportW, viewportH, x, 0)
    ctx.moveTo(Math.round(sx) + 0.5, 0)
    ctx.lineTo(Math.round(sx) + 0.5, viewportH)
  }
  for (let y = minY; y <= maxY; y++) {
    const { sy } = worldToScreen(cam, viewportW, viewportH, 0, y)
    ctx.moveTo(0, Math.round(sy) + 0.5)
    ctx.lineTo(viewportW, Math.round(sy) + 0.5)
  }
  ctx.stroke()
}
