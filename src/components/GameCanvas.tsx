import { useEffect, useRef } from 'react'
import { useGameStore } from '../store/gameStore'
import { SpriteCache } from '../render/sprites'
import { renderScene, type RenderItem, type RenderTile } from '../render/renderer'
import { screenToWorld, type Camera } from '../render/camera'
import { cellKey, collectVisible, dirDelta, nextDir, parseCellKey } from '../game/world'
import type { Dir, Machine, MachineKind } from '../game/types'
import type { MachineBuffer } from '../game/tick'
import { CATALOG_BY_ID, ITEMS_BY_ID } from '../data'
import { config } from '../data/config'

const TAP_MOVE_THRESHOLD_PX = 8

// Neighbours of a cell in the engine's fixed feed priority (N, E, S, W), paired
// with the output direction a machine in that neighbour must face to feed this
// cell. Mirrors `INCOMING` in `tick.ts` — used to guess where a belt item slid
// from between two ticks so it can be animated along that path.
const INCOMING_NB: { dx: number; dy: number; out: Dir }[] = [
  { dx: 0, dy: -1, out: 'S' },
  { dx: 1, dy: 0, out: 'W' },
  { dx: 0, dy: 1, out: 'N' },
  { dx: -1, dy: 0, out: 'E' },
]

/**
 * Best-guess source cell an item of `type` at (x,y) arrived from this tick, or
 * null if it was already here (blocked/stationary) or appeared from nowhere (a
 * spawner emit, teleporter receive). Purely visual: with only two snapshots and
 * no per-item identity we can't be exact, so we take the highest-priority upstream
 * neighbour that faces this cell and either (a) held the same item type on a belt
 * last tick, or (b) is a transforming machine (processor/combiner/village) whose
 * output hold was that item last tick — so a freshly-emitted product glides out of
 * the machine onto the belt. Splitters/crossovers emit from a side that isn't
 * simply `m.dir`, so they match on adjacency alone. Matching by type keeps
 * heterogeneous belts (bread→cheese→…) correct; a uniformly packed belt may glide
 * even when jammed, which reads fine for an idle factory.
 */
function itemSource(
  x: number,
  y: number,
  type: string,
  prev: Map<string, string>,
  prevBuffers: Map<string, MachineBuffer>,
  world: Map<string, Machine>,
): { sx: number; sy: number } | null {
  for (const nb of INCOMING_NB) {
    const nk = cellKey(x + nb.dx, y + nb.dy)
    const m = world.get(nk)
    if (!m) continue
    const faces = m.kind === 'splitter' || m.kind === 'crossover' || m.dir === nb.out
    if (!faces) continue
    if (prev.get(nk) === type) return { sx: x + nb.dx, sy: y + nb.dy }
    if (
      (m.kind === 'processor' || m.kind === 'combiner' || m.kind === 'village') &&
      prevBuffers.get(nk)?.out === type
    ) {
      return { sx: x + nb.dx, sy: y + nb.dy }
    }
  }
  return null
}

const OPPOSITE: Record<Dir, Dir> = { N: 'S', S: 'N', E: 'W', W: 'E' }

/**
 * The input side each buffer slot of a transforming machine draws from, in the
 * SAME slot order the engine uses (see `inputDirs`/`villageInputDirs` in
 * `tick.ts`), so each gathering input animates in from the correct edge:
 *  - processor: one slot, from directly behind (opposite its facing);
 *  - combiner:  two slots, the two sides perpendicular to its facing;
 *  - village:   three slots — behind, then the two perpendiculars (food/drink/bed).
 */
function inputSlotDirs(kind: MachineKind, dir: Dir): Dir[] {
  if (kind === 'processor') return [OPPOSITE[dir]]
  if (kind === 'combiner') return dir === 'E' || dir === 'W' ? ['N', 'S'] : ['E', 'W']
  if (kind === 'village') {
    const cw = nextDir(dir)
    return [OPPOSITE[dir], cw, nextDir(nextDir(cw))]
  }
  return []
}

// Production spin applied to the item as inputs fuse into the new product: one
// full turn over the spin duration, eased so it launches fast and decelerates,
// landing back at 0 = 2π (upright). `p` is progress in [0,1].
function spinAngle(p: number): number {
  const eased = 1 - Math.pow(1 - Math.min(1, Math.max(0, p)), 3) // easeOutCubic
  return eased * Math.PI * 2
}

// Small "pop" as the product forms: scales up from 0.7 to 1 over the same eased
// window, so the new item appears to burst into being rather than blink in.
function morphScale(p: number): number {
  const eased = 1 - Math.pow(1 - Math.min(1, Math.max(0, p)), 3)
  return 0.7 + 0.3 * eased
}

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

  // Item-animation bookkeeping (refs so the render loop never reads stale state).
  // `curItems` is the latest item snapshot we've drawn toward; when the store
  // swaps in a new one (every tick returns a fresh map), the outgoing snapshot
  // rolls into `prevItems` and `tickTime` restamps, so items tween from their
  // previous cell to their new one over `tickMs`.
  const prevItemsRef = useRef<Map<string, string>>(new Map())
  const curItemsRef = useRef<Map<string, string>>(new Map())
  const tickTimeRef = useRef(0)

  // Previous tick's buffer contents, needed to glide a freshly-emitted product off
  // a transforming machine onto the belt (see `itemSource`). `cur` rolls into
  // `prev` each tick, mirroring the item snapshots above.
  const prevBuffersRef = useRef<Map<string, MachineBuffer>>(new Map())
  const curBuffersRef = useRef<Map<string, MachineBuffer>>(new Map())

  // Production-spin bookkeeping: cell key → timestamp its current fuse-into-product
  // spin began, stamped from the store's `produced` set each tick (the
  // authoritative "this cell just transformed" signal). The held product spins for
  // `machineSpinMs`. A ref so the render loop reads live values without re-running.
  const spinStartRef = useRef<Map<string, number>>(new Map())

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf = 0
    let dpr = 1

    // On-demand rendering: the scene only changes when the simulation ticks, the
    // camera/selection moves, the canvas resizes, or a sprite finishes decoding.
    // Between those events nothing changes, so redrawing every rAF frame would
    // just re-paint an identical scene ~30× per tick. We mark `dirty` on any of
    // those triggers and otherwise let the loop idle — this keeps a large factory
    // from pegging the CPU/GPU at 60fps.
    //
    // The exception is item animation: while items are tweening between cells we
    // must redraw every frame for the duration of the tick. `animating` tracks
    // whether the previous frame was mid-tween so we still paint one final settled
    // frame when the tween ends, then fall back to idle.
    let dirty = true
    let animating = false
    const markDirty = () => {
      dirty = true
    }
    // Any store mutation (tick, camera pan/zoom, placement, selection) → redraw.
    const unsubscribe = useGameStore.subscribe(markDirty)

    // Respect the OS "reduce motion" preference: fall back to snapping (the
    // pre-animation behaviour) and re-render once if the preference flips.
    const motionQuery =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null
    let reduceMotion = motionQuery?.matches ?? false
    const onMotionChange = () => {
      reduceMotion = motionQuery?.matches ?? false
      markDirty()
    }
    motionQuery?.addEventListener?.('change', onMotionChange)

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 3)
      const rect = canvas.getBoundingClientRect()
      sizeRef.current = { cssW: rect.width, cssH: rect.height }
      canvas.width = Math.max(1, Math.round(rect.width * dpr))
      canvas.height = Math.max(1, Math.round(rect.height * dpr))
      markDirty()
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)

    const loop = (ts: number) => {
      const { cssW, cssH } = sizeRef.current
      const { camera, world, chunks, items, buffers, stores, crossovers, produced, ingested, selected } =
        useGameStore.getState()

      const animItems = config.animateItems && !reduceMotion
      const animMachines = config.animateMachines && !reduceMotion

      // A fresh item snapshot (every tick returns a new map) starts a new tween:
      // the outgoing snapshot becomes the "from", the new one the "to", timed from
      // now. Detected by identity so it also covers offline/reset/import swaps.
      if (items !== curItemsRef.current) {
        prevItemsRef.current = curItemsRef.current
        curItemsRef.current = items
        prevBuffersRef.current = curBuffersRef.current
        curBuffersRef.current = buffers
        tickTimeRef.current = ts
        dirty = true

        // Stamp a fresh spin on every machine that produced a new output this tick.
        // Re-stamping each tick keeps a saturated machine (transforming on every
        // tick) spinning continuously.
        if (animMachines) for (const key of produced) spinStartRef.current.set(key, ts)
      }

      const tRaw = config.tickMs > 0 ? (ts - tickTimeRef.current) / config.tickMs : 1
      // Item tween in progress: animation on, items present, still within the tick.
      const itemTween = animItems && items.size > 0 && tRaw < 1
      // Any machine still inside its spin window keeps the loop live; prune the
      // rest so the map can't grow without bound.
      let spinActive = false
      if (animMachines) {
        for (const [key, start] of spinStartRef.current) {
          if (ts - start < config.machineSpinMs) spinActive = true
          else spinStartRef.current.delete(key)
        }
      } else if (spinStartRef.current.size > 0) {
        spinStartRef.current.clear()
      }
      // Ingredients that arrived this tick glide onto their machine over the tick.
      const intakeActive = animMachines && tRaw < 1 && ingested.size > 0
      const animActive = itemTween || spinActive || intakeActive
      // When the last animation just finished, paint one final settled frame.
      const finalFrame = animating && !animActive
      if (!dirty && !animActive && !finalFrame) {
        raf = requestAnimationFrame(loop)
        return
      }
      dirty = false
      animating = animActive
      const t = animItems ? Math.min(1, Math.max(0, tRaw)) : 1
      // Separate progress for machine-item animation, so it works even if belt
      // item tweening is disabled.
      const tMachine = animMachines ? Math.min(1, Math.max(0, tRaw)) : 1

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
        label: m.kind === 'teleporter' ? m.channel : undefined,
      }))

      const itemTiles: RenderItem[] = []
      // Belt/splitter items glide from the cell they arrived from toward their
      // current cell across the tick; a jam or a just-appeared item stays put. An
      // item freshly emitted by a transforming machine glides off it too (the
      // machine's output hold is the source — see `itemSource`).
      const tween = t < 1 && (prevItemsRef.current.size > 0 || prevBuffersRef.current.size > 0)
      const prevItems = prevItemsRef.current
      const prevBuffers = prevBuffersRef.current
      for (const [key, type] of items) {
        const { x, y } = parseCellKey(key)
        if (x < minCx || x > maxCx || y < minCy || y > maxCy) continue
        const emoji = ITEMS_BY_ID[type]?.emoji
        if (!emoji) continue
        let cx = x
        let cy = y
        if (tween) {
          const src = itemSource(x, y, type, prevItems, prevBuffers, world)
          if (src) {
            cx = src.sx + (x - src.sx) * t
            cy = src.sy + (y - src.sy) * t
          }
        }
        itemTiles.push({ cx, cy, emoji })
      }

      // Items inside a transforming machine (processor/combiner/village), animated
      // in three phases keyed off the engine's signals. Ingredients and the product
      // are drawn together (not either/or), so a busy machine still shows its inputs
      // arriving while it holds/forms a product:
      //  1. Onto — each filled input sits near its own input edge; one that arrived
      //     this tick (`ingested`) glides in from the neighbour cell.
      //  2. Fuse — once the output forms (`produced`), the product spins and pops in
      //     at the centre for `machineSpinMs`.
      //  3. Off — handled in the belt loop above: the emitted product glides off.
      const REST = 0.26 // how far a gathering input sits toward its input edge
      for (const [key, b] of buffers) {
        const { x, y } = parseCellKey(key)
        if (x < minCx || x > maxCx || y < minCy || y > maxCy) continue
        const m = world.get(key)
        if (!m) continue

        // Ingredients approaching / resting at their input edges.
        const dirs = inputSlotDirs(m.kind, m.dir)
        const arrived = animMachines ? ingested.get(key) : undefined
        for (let k = 0; k < b.in.length; k++) {
          const slot = b.in[k]
          if (slot == null) continue
          const emoji = ITEMS_BY_ID[slot]?.emoji
          if (!emoji) continue
          const side = dirs[k]
          const d = side ? dirDelta(side) : { dx: 0, dy: 0 }
          let cx = x + d.dx * REST
          let cy = y + d.dy * REST
          // Glide in from the neighbour cell on the tick this input arrived.
          if (side && tMachine < 1 && arrived?.includes(k)) {
            const fromX = x + d.dx
            const fromY = y + d.dy
            cx = fromX + (cx - fromX) * tMachine
            cy = fromY + (cy - fromY) * tMachine
          }
          itemTiles.push({ cx, cy, emoji })
        }

        // The product held at the centre, spinning + popping during its fuse window.
        if (b.out != null) {
          const emoji = ITEMS_BY_ID[b.out]?.emoji
          if (!emoji) continue
          const start = animMachines ? spinStartRef.current.get(key) : undefined
          if (start !== undefined) {
            const p = (ts - start) / config.machineSpinMs
            itemTiles.push({ cx: x, cy: y, emoji, spin: spinAngle(p), scale: morphScale(p) })
          } else {
            itemTiles.push({ cx: x, cy: y, emoji })
          }
        }
      }

      // Crossovers carry two items at once (one per lane); nudge them apart so
      // both are visible instead of overlapping on the shared cell.
      for (const [key, cs] of crossovers) {
        const { x, y } = parseCellKey(key)
        if (x < minCx || x > maxCx || y < minCy || y > maxCy) continue
        if (cs.v) {
          const emoji = ITEMS_BY_ID[cs.v.item]?.emoji
          if (emoji) itemTiles.push({ cx: x, cy: y - 0.16, emoji })
        }
        if (cs.h) {
          const emoji = ITEMS_BY_ID[cs.h.item]?.emoji
          if (emoji) itemTiles.push({ cx: x + 0.16, cy: y, emoji })
        }
      }

      // Storage shows the item type it's holding, so a filling store doesn't
      // look like items are vanishing into it (the exact count is in its panel).
      for (const [key, st] of stores) {
        if (!st.item || st.count <= 0) continue
        const { x, y } = parseCellKey(key)
        if (x < minCx || x > maxCx || y < minCy || y > maxCy) continue
        const emoji = ITEMS_BY_ID[st.item]?.emoji
        if (emoji) itemTiles.push({ cx: x, cy: y, emoji })
      }

      renderScene(ctx, camera, cssW, cssH, dpr, spritesRef.current, tiles, itemTiles, selected)
      // Sprites decode asynchronously: if any drawn this frame wasn't ready yet,
      // keep redrawing so it appears the moment its bitmap lands.
      if (spritesRef.current.hasPending()) dirty = true
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      unsubscribe()
      motionQuery?.removeEventListener?.('change', onMotionChange)
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

    if (pointers.current.size === 0) {
      gesture.current = null
    } else if (pointers.current.size === 1) {
      // Lifting one finger of a pinch: re-anchor panning to the finger still
      // down so the camera doesn't jump, and never treat the tail as a tap.
      const [remaining] = [...pointers.current.values()]
      gesture.current = {
        moved: TAP_MOVE_THRESHOLD_PX + 1,
        startX: remaining.x,
        startY: remaining.y,
        pinchDist: null,
      }
    }
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
