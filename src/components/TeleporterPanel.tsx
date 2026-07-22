import { useGameStore } from '../store/gameStore'
import { CATALOG_BY_ID } from '../data'
import { cellKey } from '../game/world'
import { Emoji } from './Emoji'

/** Match the tick engine's channel rule: trimmed + lower-cased, empty = unlinked. */
function normalizeChannel(channel: string | undefined): string | null {
  const c = (channel ?? '').trim().toLowerCase()
  return c.length > 0 ? c : null
}

/**
 * Inspector shown when the Select tool picks a teleporter pad. Lets the player
 * type the channel label that links input pads to output pads, and reports the
 * live network: how many send/receive pads share the label and how many items
 * are currently in transit on it. Many inputs and many outputs are both allowed
 * — the queue splits evenly across all outputs.
 */
export function TeleporterPanel() {
  const selected = useGameStore((s) => s.selected)
  const world = useGameStore((s) => s.world)
  const transit = useGameStore((s) => s.transit)
  const setChannel = useGameStore((s) => s.setChannel)
  // Re-read on every structural change so pad counts stay live as you edit/build.
  useGameStore((s) => s.worldRev)

  if (!selected) return null
  const key = cellKey(selected.x, selected.y)
  const machine = world.get(key)
  if (!machine || machine.kind !== 'teleporter') return null

  const entry = CATALOG_BY_ID[machine.catalogId]
  const isSend = entry?.role === 'send'
  const ch = normalizeChannel(machine.channel)

  // Count the pads sharing this channel, and the depth of its transit queue.
  let sends = 0
  let receives = 0
  if (ch !== null) {
    for (const m of world.values()) {
      if (m.kind !== 'teleporter') continue
      if (normalizeChannel(m.channel) !== ch) continue
      if (CATALOG_BY_ID[m.catalogId]?.role === 'send') sends++
      else receives++
    }
  }
  const queued = ch !== null ? transit.get(ch)?.length ?? 0 : 0

  const linkedCount = isSend ? receives : sends
  const linkedNoun = isSend ? 'output' : 'input'

  return (
    <aside className="panel" aria-label="Teleporter">
      <header className="panel__head">
        <span className="panel__title">
          <Emoji emoji={entry?.emoji ?? '📡'} size={18} label="teleporter" />{' '}
          Teleporter ({isSend ? 'In' : 'Out'})
        </span>
        <button
          type="button"
          className="panel__close"
          aria-label="Close"
          onClick={() => useGameStore.setState({ selected: null })}
        >
          ✕
        </button>
      </header>

      <div className="panel__body">
        <label className="panel__section-label" htmlFor="teleporter-channel">
          Channel
        </label>
        <input
          id="teleporter-channel"
          className="panel__input"
          type="text"
          placeholder="e.g. coal"
          maxLength={24}
          value={machine.channel ?? ''}
          onChange={(e) => setChannel(selected.x, selected.y, e.target.value)}
        />
        <p className="panel__hint">
          {isSend
            ? 'Items dropped here reappear at every output pad with the same channel.'
            : 'Emits items sent from any input pad on the same channel.'}
        </p>

        {ch === null ? (
          <p className="panel__empty">Unlinked — type a channel to connect this pad.</p>
        ) : (
          <ul className="teleporter__stats">
            <li className="panel__row">
              <span className="panel__muted">Linked {linkedNoun}s</span>
              <span className="panel__value">{linkedCount}</span>
            </li>
            <li className="panel__row">
              <span className="panel__muted">In transit</span>
              <span className="panel__value">{queued}</span>
            </li>
          </ul>
        )}
        {ch !== null && linkedCount === 0 && (
          <p className="panel__empty">
            No matching {linkedNoun} pad yet — place a Teleporter ({isSend ? 'Out' : 'In'}) on “{ch}”.
          </p>
        )}
      </div>
    </aside>
  )
}
