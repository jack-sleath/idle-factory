import { useGameStore } from '../store/gameStore'
import { basePrice, ITEMS_BY_ID, storageCapacity } from '../data'
import { cellKey } from '../game/world'
import { formatMoney, formatShort } from '../lib/format'
import { Emoji } from './Emoji'

/**
 * Inspector shown when the Select tool picks a storage cell: what it holds, how
 * full it is, and its liquidation value with a Sell-All button. Reads live
 * store state so the count and value tick up as items arrive.
 */
export function StoragePanel() {
  const selected = useGameStore((s) => s.selected)
  const world = useGameStore((s) => s.world)
  const stores = useGameStore((s) => s.stores)
  const sellAll = useGameStore((s) => s.sellAll)

  if (!selected) return null
  const key = cellKey(selected.x, selected.y)
  const machine = world.get(key)
  if (!machine || machine.kind !== 'storage') return null

  const store = stores.get(key)
  const capacity = storageCapacity(machine.catalogId)
  const item = store?.item ?? null
  const count = store?.count ?? 0
  const def = item ? ITEMS_BY_ID[item] : undefined
  const unit = item ? basePrice(item) : 0
  const total = count * unit

  return (
    <aside className="panel" aria-label="Storage">
      <header className="panel__head">
        <span className="panel__title">
          <Emoji emoji="📦" size={18} label="storage" /> Storage
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

      {item && def ? (
        <div className="panel__body">
          <div className="panel__row">
            <span className="panel__item">
              <Emoji emoji={def.emoji} size={20} label={def.name} /> {def.name}
            </span>
            <span className="panel__muted">
              {formatShort(count)} / {formatShort(capacity)}
            </span>
          </div>
          <div className="panel__row">
            <span className="panel__muted">Unit {formatMoney(unit)}</span>
            <span className="panel__value">{formatMoney(total)}</span>
          </div>
          <button
            type="button"
            className="panel__sell"
            disabled={count <= 0}
            onClick={() => sellAll(selected.x, selected.y)}
          >
            Sell All
          </button>
        </div>
      ) : (
        <p className="panel__empty">Empty — it locks onto the first item type it receives.</p>
      )}
    </aside>
  )
}
