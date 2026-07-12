import { create } from 'zustand'
import type { Camera } from '../render/camera'

// Minimal store for the Milestone 1 scaffold: it holds the pan/zoom camera so
// the canvas and (future) UI share a single source of truth. The sparse world,
// items, money, and market join this store in later milestones.
interface GameState {
  camera: Camera
  setCamera: (camera: Camera) => void
}

const DEFAULT_CAMERA: Camera = { x: 1.5, y: 1, zoom: 72 }

export const useGameStore = create<GameState>((set) => ({
  camera: DEFAULT_CAMERA,
  setCamera: (camera) => set({ camera }),
}))
