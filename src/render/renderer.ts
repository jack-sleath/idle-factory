import { worldToScreen, screenToWorld, type Camera } from './camera'
import type { SpriteCache } from './sprites'
import type { Dir, MachineKind } from '../game/types'
import { dirAngle, dirDelta, nextDir } from '../game/world'

/** A machine to draw, in integer world-cell coordinates. */
export interface RenderTile {
  cx: number
  cy: number
  emoji: string
  kind: MachineKind
  dir: Dir
  /** Optional caption drawn under the sprite (teleporter channel label). */
  label?: string
}

/** An item riding a cell, drawn on top of machines. */
export interface RenderItem {
  cx: number
  cy: number
  emoji: string
}

const GRID_COLOR = 'rgba(255, 255, 255, 0.05)'
const BG_COLOR = '#141b22'
const ACCENT = '#f0b429'

/**
 * Draws the visible scene: a faint grid, an optional selection highlight, and
 * every provided tile (already culled to the viewport by the caller). Belts are
 * drawn as arrows rotated to their facing; other machines are drawn upright
 * with a chevron on their output edge so orientation is always visible.
 * Coordinates are CSS pixels; the caller sets the device-pixel-ratio transform.
 */
export function renderScene(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  viewportW: number,
  viewportH: number,
  dpr: number,
  sprites: SpriteCache,
  tiles: Iterable<RenderTile>,
  items: Iterable<RenderItem>,
  selected: { x: number; y: number } | null,
): void {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, viewportW, viewportH)
  ctx.fillStyle = BG_COLOR
  ctx.fillRect(0, 0, viewportW, viewportH)

  drawGrid(ctx, cam, viewportW, viewportH)

  const cell = cam.zoom

  if (selected) {
    const { sx, sy } = worldToScreen(cam, viewportW, viewportH, selected.x + 0.5, selected.y + 0.5)
    ctx.strokeStyle = ACCENT
    ctx.lineWidth = 2
    ctx.strokeRect(sx - cell / 2, sy - cell / 2, cell, cell)
    ctx.fillStyle = 'rgba(240, 180, 41, 0.12)'
    ctx.fillRect(sx - cell / 2, sy - cell / 2, cell, cell)
  }

  const spriteSize = cell * 0.86

  for (const t of tiles) {
    const { sx, sy } = worldToScreen(cam, viewportW, viewportH, t.cx + 0.5, t.cy + 0.5)
    if (sx < -cell || sx > viewportW + cell || sy < -cell || sy > viewportH + cell) {
      continue
    }

    const bitmap = sprites.get(t.emoji)

    if (t.kind === 'belt') {
      // Belts show their facing by rotating the arrow sprite itself.
      if (bitmap) {
        ctx.save()
        ctx.translate(sx, sy)
        ctx.rotate(dirAngle(t.dir))
        ctx.drawImage(bitmap, -spriteSize / 2, -spriteSize / 2, spriteSize, spriteSize)
        ctx.restore()
      } else {
        drawPlaceholder(ctx, sx, sy, spriteSize)
      }
      continue
    }

    if (bitmap) {
      ctx.drawImage(bitmap, sx - spriteSize / 2, sy - spriteSize / 2, spriteSize, spriteSize)
    } else {
      drawPlaceholder(ctx, sx, sy, spriteSize)
    }
    // Non-belt machines get a chevron on the output edge to show orientation. A
    // splitter emits from its three non-input sides, so it gets a chevron on each.
    // A crossover passes straight through on both axes, so it gets all four.
    if (t.kind === 'splitter') {
      const cw = nextDir(t.dir)
      for (const d of [t.dir, cw, nextDir(nextDir(cw))]) drawChevron(ctx, sx, sy, cell, d)
    } else if (t.kind === 'crossover') {
      for (const d of ['N', 'E', 'S', 'W'] as Dir[]) drawChevron(ctx, sx, sy, cell, d)
    } else {
      drawChevron(ctx, sx, sy, cell, t.dir)
    }

    if (t.label) drawLabel(ctx, sx, sy, cell, t.label)
  }

  // Items ride on top of the belt cells, drawn a little smaller.
  const itemSize = cell * 0.6
  for (const it of items) {
    const { sx, sy } = worldToScreen(cam, viewportW, viewportH, it.cx + 0.5, it.cy + 0.5)
    if (sx < -cell || sx > viewportW + cell || sy < -cell || sy > viewportH + cell) {
      continue
    }
    const bitmap = sprites.get(it.emoji)
    if (bitmap) {
      ctx.drawImage(bitmap, sx - itemSize / 2, sy - itemSize / 2, itemSize, itemSize)
    }
  }
}

function drawPlaceholder(ctx: CanvasRenderingContext2D, sx: number, sy: number, size: number): void {
  ctx.fillStyle = 'rgba(255,255,255,0.08)'
  ctx.fillRect(sx - size / 2, sy - size / 2, size, size)
}

/** Small filled triangle at the output edge of a cell, pointing outward. */
function drawChevron(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  cell: number,
  dir: Dir,
): void {
  const { dx, dy } = dirDelta(dir)
  const edge = cell * 0.44 // distance from centre to just inside the edge
  const cxp = sx + dx * edge
  const cyp = sy + dy * edge
  // Perpendicular unit vector for the triangle base.
  const px = -dy
  const py = dx
  const tip = cell * 0.1
  const half = cell * 0.09

  ctx.fillStyle = ACCENT
  ctx.beginPath()
  ctx.moveTo(cxp + dx * tip, cyp + dy * tip) // tip pointing outward
  ctx.lineTo(cxp + px * half, cyp + py * half)
  ctx.lineTo(cxp - px * half, cyp - py * half)
  ctx.closePath()
  ctx.fill()
}

/** Draws a small centred caption just below a cell's sprite (channel labels). */
function drawLabel(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  cell: number,
  text: string,
): void {
  const size = Math.max(8, Math.round(cell * 0.16))
  ctx.font = `600 ${size}px system-ui, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const label = text.length > 12 ? `${text.slice(0, 11)}…` : text
  const w = ctx.measureText(label).width
  const py = sy + cell * 0.34
  const padX = size * 0.4
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
  ctx.fillRect(sx - w / 2 - padX, py - size * 0.7, w + padX * 2, size * 1.4)
  ctx.fillStyle = ACCENT
  ctx.fillText(label, sx, py)
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
