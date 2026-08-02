import type { AchievementDef } from './achievements'

// The plug point for external achievement systems (Steam, consoles, mobile game
// services, an analytics sink, …). The game logic in the store unlocks an
// achievement LOCALLY (persisting it + surfacing a toast); it then hands the
// unlocked definition to every registered provider, which is responsible for
// mirroring it onto its platform. Nothing in the store, engine, or UI knows what
// a provider does — so adding Steam support is purely additive: implement this
// interface and register it at app start.
//
// Each provider translates our achievement id into its own via the definition's
// `external[provider.id]` map (see AchievementDef.external), so the id namespaces
// stay decoupled. A provider is free to ignore an achievement it has no mapping
// for (an unmapped id resolves to `undefined`).
//
// Example — a Steam adapter over a native bridge a desktop shell would inject
// (Electron/Tauri/greenworks/steamworks.js all expose something like this):
//
//   registerAchievementProvider({
//     id: 'steam',
//     syncUnlocked(defs) {
//       for (const d of defs) {
//         const key = d.external?.steam
//         if (key) window.steamworks?.achievement.activate(key)
//       }
//       window.steamworks?.stats.store()
//     },
//     unlock(def) {
//       const key = def.external?.steam
//       if (!key) return
//       window.steamworks?.achievement.activate(key)
//       window.steamworks?.stats.store()
//     },
//   })
//
// Because unlocks are idempotent on every platform we target (re-activating an
// already-unlocked Steam achievement is a no-op), providers need not de-dupe.

/**
 * A sink that mirrors local achievement unlocks onto an external service. The
 * store owns the source of truth; a provider is a one-way downstream mirror.
 */
export interface AchievementProvider {
  /** Stable provider id; also the key used to look up `AchievementDef.external[id]`. */
  readonly id: string
  /**
   * Called once, shortly after the provider registers, with EVERY achievement
   * already unlocked in the save. Lets a platform reconcile its state on boot
   * (Steam in particular expects the client to re-assert unlocked achievements).
   * Optional — a fire-and-forget sink can skip it.
   */
  syncUnlocked?(defs: AchievementDef[]): void
  /** Called with each achievement as it unlocks during play. */
  unlock(def: AchievementDef): void
}

const providers = new Map<string, AchievementProvider>()

/**
 * Register a provider (idempotent by id — re-registering replaces). Returns an
 * unregister function for teardown/tests. If `initialUnlocked` is supplied, the
 * provider's `syncUnlocked` is invoked immediately so it can reconcile a save
 * that already holds unlocks.
 */
export function registerAchievementProvider(
  provider: AchievementProvider,
  initialUnlocked?: AchievementDef[],
): () => void {
  providers.set(provider.id, provider)
  if (initialUnlocked && initialUnlocked.length > 0) {
    safe(() => provider.syncUnlocked?.(initialUnlocked), provider.id)
  }
  return () => {
    if (providers.get(provider.id) === provider) providers.delete(provider.id)
  }
}

/** Remove a provider by id (mainly for tests). */
export function unregisterAchievementProvider(id: string): void {
  providers.delete(id)
}

/** Drop all providers (test isolation). */
export function clearAchievementProviders(): void {
  providers.clear()
}

/** Fan a single unlock out to every registered provider. Never throws. */
export function notifyUnlock(def: AchievementDef): void {
  for (const provider of providers.values()) {
    safe(() => provider.unlock(def), provider.id)
  }
}

/** Push the full already-unlocked set to every provider (e.g. after a save loads). */
export function syncProviders(unlockedDefs: AchievementDef[]): void {
  if (unlockedDefs.length === 0) return
  for (const provider of providers.values()) {
    safe(() => provider.syncUnlocked?.(unlockedDefs), provider.id)
  }
}

// A misbehaving external SDK must never take the game down with it: isolate every
// provider call and log rather than propagate.
function safe(fn: () => void, providerId: string): void {
  try {
    fn()
  } catch (err) {
    if (typeof console !== 'undefined') {
      console.error(`achievement provider "${providerId}" threw:`, err)
    }
  }
}

/**
 * The bridge a native shell (Electron/Tauri/Steam wrapper) exposes on `window`.
 * The web build ships nothing here — the game runs fine with no host. A desktop
 * build injects an implementation, e.g. a thin Steamworks wrapper:
 *
 *   window.gameAchievements = {
 *     unlock: (key) => steamworks.achievement.activate(key),
 *     sync:   (keys) => { keys.forEach((k) => steamworks.achievement.activate(k)); steamworks.stats.store() },
 *   }
 */
export interface AchievementHostBridge {
  /** Unlock one achievement by its external (platform) id. */
  unlock(externalId: string): void
  /** Optional: re-assert the full set of already-unlocked external ids on boot. */
  sync?(externalIds: string[]): void
}

declare global {
  interface Window {
    gameAchievements?: AchievementHostBridge
  }
}

/**
 * A provider that forwards unlocks to a native host bridge on `window` under a
 * given provider id (default `"steam"`), translating each achievement via its
 * `external[id]` mapping. This is the concrete plug point: a desktop/Steam build
 * sets `window.gameAchievements` before the app registers this, and unlocks flow
 * through with zero changes to game logic. On the plain web (no bridge) every
 * call is a harmless no-op, so it is always safe to register.
 */
export function createHostBridgeProvider(id = 'steam'): AchievementProvider {
  const bridge = (): AchievementHostBridge | undefined =>
    typeof window !== 'undefined' ? window.gameAchievements : undefined
  return {
    id,
    syncUnlocked(defs) {
      const host = bridge()
      if (!host) return
      const keys = defs.map((d) => d.external?.[id]).filter((k): k is string => !!k)
      if (keys.length === 0) return
      if (host.sync) host.sync(keys)
      else for (const k of keys) host.unlock(k)
    },
    unlock(def) {
      const key = def.external?.[id]
      if (key) bridge()?.unlock(key)
    },
  }
}
