import { useEffect, useRef } from 'react'
import { useGameStore } from '../store/gameStore'
import { SpriteCache } from '../render/sprites'
import { renderScene } from '../render/renderer'
import { DEMO_TILES } from '../render/demoScene'

/**
 * Hosts the world `<canvas>`: sizes it to its container (device-pixel-ratio
 * aware), runs the render loop in requestAnimationFrame, and drives camera
 * panning from pointer drags. Reads the camera from the Zustand store each
 * frame so state stays in one place.
 */
export function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const spritesRef = useRef<SpriteCache>(new SpriteCache())
  const dragRef = useRef<{ x: number; y: number } | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf = 0
    let dpr = 1
    let cssW = 0
    let cssH = 0

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 3)
      const rect = canvas.getBoundingClientRect()
      cssW = rect.width
      cssH = rect.height
      canvas.width = Math.max(1, Math.round(cssW * dpr))
      canvas.height = Math.max(1, Math.round(cssH * dpr))
    }
    resize()

    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    const loop = () => {
      const { camera } = useGameStore.getState()
      renderScene(ctx, camera, cssW, cssH, dpr, spritesRef.current, DEMO_TILES)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
    }
  }, [])

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = { x: e.clientX, y: e.clientY }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const dxPx = e.clientX - drag.x
    const dyPx = e.clientY - drag.y
    dragRef.current = { x: e.clientX, y: e.clientY }

    const { camera, setCamera } = useGameStore.getState()
    // Dragging right/down should move the world with the pointer, i.e. the
    // camera centre moves left/up in world space.
    setCamera({
      ...camera,
      x: camera.x - dxPx / camera.zoom,
      y: camera.y - dyPx / camera.zoom,
    })
  }

  const endDrag = (e: React.PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  return (
    <canvas
      ref={canvasRef}
      className="game-canvas"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    />
  )
}
