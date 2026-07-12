// The camera maps between world space (cell coordinates, signed & unbounded)
// and screen space (CSS pixels). It is a plain data object so it can live in
// the Zustand store and be serialized with the save later.

export interface Camera {
  /** World coordinate rendered at the centre of the viewport. */
  x: number
  y: number
  /** Pixels per world cell. */
  zoom: number
}

export interface ScreenPoint {
  sx: number
  sy: number
}

export interface WorldPoint {
  wx: number
  wy: number
}

/** World point → screen (CSS px), given the current viewport size. */
export function worldToScreen(
  cam: Camera,
  viewportW: number,
  viewportH: number,
  wx: number,
  wy: number,
): ScreenPoint {
  return {
    sx: viewportW / 2 + (wx - cam.x) * cam.zoom,
    sy: viewportH / 2 + (wy - cam.y) * cam.zoom,
  }
}

/** Screen point (CSS px) → world coordinate. */
export function screenToWorld(
  cam: Camera,
  viewportW: number,
  viewportH: number,
  sx: number,
  sy: number,
): WorldPoint {
  return {
    wx: (sx - viewportW / 2) / cam.zoom + cam.x,
    wy: (sy - viewportH / 2) / cam.zoom + cam.y,
  }
}

/** The world cell (integer coords) under a screen point. */
export function screenToCell(
  cam: Camera,
  viewportW: number,
  viewportH: number,
  sx: number,
  sy: number,
): { cx: number; cy: number } {
  const { wx, wy } = screenToWorld(cam, viewportW, viewportH, sx, sy)
  return { cx: Math.floor(wx), cy: Math.floor(wy) }
}
