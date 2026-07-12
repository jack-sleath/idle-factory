import { useEffect, useRef } from 'react'
import { useGameStore } from '../store/gameStore'
import { SpriteCache } from '../render/sprites'
import { renderScene, type RenderItem, type RenderTile } from '../render/renderer'
import { screenToWorld, type Camera } from '../render/camera'
import { collectVisible, parseCellKey } from '../game/world'
import { CATALOG_BY_ID, ITEMS_BY_ID } from '../data'
import { config } from '../data/config'

const TAP_MOVE_THRESHOLD_PX = 8

function clampZoom(zoom: number): number {
  return Math.max(config.zoomMin, Math.min(config.zoomMax, zoom))
}

/** Zoom so the world point under (sx,sy) stays fixed on screen. */
function zoomAround(cam: Camera, vpW: number, vpH: number, sx: number, sy: number, nextZoom: number): Camera {
  const before = screenToWorld(cam, vpW, vpH, sx, sy)
  const zoom = clampZoom(nextZoom)
  // Solve for camera centre so `before` maps back to (sx, sy) at the new zoom.
  return {
    zoom,
    x: before.wx - (sx - vpW / 2) / zoom,
    y: before.wy - (sy - vpH / 2) / zoom,
  }
}

/**
 * Hosts the world `<canvas>`: sizes it (DPR-aware), runs the render loop, and
 * turns pointer input into camera pan, pinch/wheel zoom, and tap-to-act (a tap
 * dispatches the active tool at the tapped cell; a drag pans instead).
 */
export function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const spritesRef = useRef<SpriteCache>(new SpriteCache())

  // Active pointers (for pan vs. pinch), gesture bookkeeping in refs so the
  // handlers and render loop never work from stale state.
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map())
  const gesture = useRef<{
    moved: number
    startX: number
    startY: number
    pinchDist: number | null
  } | null>(null)
  const sizeRef = useRef({ cssW: 0, cssH: 0 })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf = 0
    let dpr = 1

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 3)
      const rect = canvas.getBoundingClientRect()
      sizeRef.current = { cssW: rect.width, cssH: rect.height }
      canvas.width = Math.max(1, Math.round(rect.width * dpr))
      canvas.height = Math.max(1, Math.round(rect.height * dpr))
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    const loop = () => {
      const { cssW, cssH } = sizeRef.current
      const { camera, world, chunks, items, selected } = useGameStore.getState()

      // Cull to the visible cell rectangle via the chunk index.
      const tl = screenToWorld(camera, cssW, cssH, 0, 0)
      const br = screenToWorld(camera, cssW, cssH, cssW, cssH)
      const minCx = Math.floor(tl.wx) - 1
      const minCy = Math.floor(tl.wy) - 1
      const maxCx = Math.ceil(br.wx) + 1
      const maxCy = Math.ceil(br.wy) + 1
      const machines = collectVisible(world, chunks, config.chunkSize, minCx, minCy, maxCx, maxCy)
      const tiles: RenderTile[] = machines.map((m) => ({
        cx: m.x,
        cy: m.y,
        emoji: CATALOG_BY_ID[m.catalogId]?.emoji ?? '❓',
        kind: m.kind,
        dir: m.dir,
      }))

      const itemTiles: RenderItem[] = []
      for (const [key, type] of items) {
        const { x, y } = parseCellKey(key)
        if (x < minCx || x > maxCx || y < minCy || y > maxCy) continue
        const emoji = ITEMS_BY_ID[type]?.emoji
        if (emoji) itemTiles.push({ cx: x, cy: y, emoji })
      }

      renderScene(ctx, camera, cssW, cssH, dpr, spritesRef.current, tiles, itemTiles, selected)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
    }
  }, [])

  const localPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = localPoint(e)
    pointers.current.set(e.pointerId, p)
    e.currentTarget.setPointerCapture(e.pointerId)

    if (pointers.current.size === 1) {
      gesture.current = { moved: 0, startX: p.x, startY: p.y, pinchDist: null }
    } else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      gesture.current = {
        moved: TAP_MOVE_THRESHOLD_PX + 1, // a two-finger gesture is never a tap
        startX: p.x,
        startY: p.y,
        pinchDist: Math.hypot(a.x - b.x, a.y - b.y),
      }
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!pointers.current.has(e.pointerId)) return
    const prev = pointers.current.get(e.pointerId)!
    const p = localPoint(e)
    pointers.current.set(e.pointerId, p)
    const g = gesture.current
    if (!g) return

    const { cssW, cssH } = sizeRef.current
    const { camera, setCamera } = useGameStore.getState()

    if (pointers.current.size >= 2 && g.pinchDist != null) {
      // Pinch-zoom around the midpoint of the two active pointers.
      const [a, b] = [...pointers.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      const midX = (a.x + b.x) / 2
      const midY = (a.y + b.y) / 2
      if (dist > 0 && g.pinchDist > 0) {
        setCamera(zoomAround(camera, cssW, cssH, midX, midY, camera.zoom * (dist / g.pinchDist)))
      }
      g.pinchDist = dist
      return
    }

    // Single-pointer drag → pan (and accumulate movement to distinguish taps).
    const dxPx = p.x - prev.x
    const dyPx = p.y - prev.y
    g.moved += Math.abs(dxPx) + Math.abs(dyPx)
    setCamera({ ...camera, x: camera.x - dxPx / camera.zoom, y: camera.y - dyPx / camera.zoom })
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = gesture.current
    const wasSinglePointer = pointers.current.size === 1
    pointers.current.delete(e.pointerId)
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }

    // A quick single-pointer press that didn't travel is a tap → tool action.
    if (wasSinglePointer && g && g.moved <= TAP_MOVE_THRESHOLD_PX) {
      const { cssW, cssH } = sizeRef.current
      const { camera, tapCell } = useGameStore.getState()
      const { wx, wy } = screenToWorld(camera, cssW, cssH, g.startX, g.startY)
      tapCell(Math.floor(wx), Math.floor(wy))
    }

    if (pointers.current.size === 0) gesture.current = null
  }

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const { cssW, cssH } = sizeRef.current
    const { camera, setCamera } = useGameStore.getState()
    const rect = e.currentTarget.getBoundingClientRect()
    const factor = Math.exp(-e.deltaY * 0.0015)
    setCamera(
      zoomAround(camera, cssW, cssH, e.clientX - rect.left, e.clientY - rect.top, camera.zoom * factor),
    )
  }

  return (
    <canvas
      ref={canvasRef}
      className="game-canvas"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
    />
  )
}
