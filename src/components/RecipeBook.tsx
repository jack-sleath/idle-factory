import { Fragment, useMemo, useState } from 'react'
import { ITEMS_BY_ID, RECIPES } from '../data'
import {
  machineMeta,
  sourcesFor,
  spawnerRows,
  villageBrowseRequirements,
  VILLAGE_OUTPUT,
  type Requirement,
  type RecipeSource,
} from '../game/recipeGraph'
import { formatMoney } from '../lib/format'
import { Emoji } from './Emoji'

/** A clickable item pill (emoji + name). Opens that item's production tree. */
function ItemChip({
  itemId,
  onOpen,
  size = 16,
}: {
  itemId: string
  onOpen: (id: string) => void
  size?: number
}) {
  const item = ITEMS_BY_ID[itemId]
  const label = item?.name ?? itemId
  return (
    <button type="button" className="recipe__chip" onClick={() => onOpen(itemId)} title={`Show recipe for ${label}`}>
      <Emoji emoji={item?.emoji ?? '❓'} size={size} label={label} />
      <span className="recipe__chip-name">{label}</span>
    </button>
  )
}

/** Small machine badge (emoji + name) shown on each recipe row / tree node. */
function MachineBadge({ source }: { source: RecipeSource }) {
  const meta = machineMeta(source)
  return (
    <span className="recipe__machine">
      <Emoji emoji={meta.emoji} size={14} label={meta.name} />
      <span>{meta.name}</span>
    </span>
  )
}

/** Prev/next flick control with a "n / total" counter. */
function Flicker({
  index,
  total,
  onChange,
  label,
}: {
  index: number
  total: number
  onChange: (next: number) => void
  label: string
}) {
  return (
    <span className="recipe__flick" role="group" aria-label={label}>
      <button
        type="button"
        className="recipe__flick-btn"
        aria-label={`Previous ${label}`}
        onClick={() => onChange((index - 1 + total) % total)}
      >
        ◀
      </button>
      <span className="recipe__flick-count">
        {index + 1}/{total}
      </span>
      <button
        type="button"
        className="recipe__flick-btn"
        aria-label={`Next ${label}`}
        onClick={() => onChange((index + 1) % total)}
      >
        ▶
      </button>
    </span>
  )
}

/**
 * One node of the production tree: a slot filled by one of `candidates`. When
 * a slot accepts several items (a village hut's food/drink) the flicker cycles
 * through them, and when the chosen item can be made several ways a second
 * flicker cycles the recipe. The chosen item then expands into its own inputs.
 * `ancestry` guards against cyclic recipes running away.
 */
function TreeNode({
  requirement,
  depth,
  ancestry,
  onOpen,
}: {
  requirement: Requirement
  depth: number
  ancestry: readonly string[]
  onOpen: (id: string) => void
}) {
  const [candIdx, setCandIdx] = useState(0)
  const [srcIdx, setSrcIdx] = useState(0)

  const idx = Math.min(candIdx, requirement.candidates.length - 1)
  const itemId = requirement.candidates[idx]
  const item = ITEMS_BY_ID[itemId]

  const cyclic = ancestry.includes(itemId)
  const sources = cyclic || depth > 20 ? [] : sourcesFor(itemId)
  const source = sources.length > 0 ? sources[Math.min(srcIdx, sources.length - 1)] : null

  return (
    <div className="recipe__node">
      <div className="recipe__node-head">
        {requirement.slotLabel && <span className="recipe__slot">{requirement.slotLabel}</span>}
        {requirement.candidates.length > 1 && (
          <Flicker
            index={idx}
            total={requirement.candidates.length}
            onChange={setCandIdx}
            label={requirement.slotLabel ? `${requirement.slotLabel} option` : 'ingredient'}
          />
        )}
        <ItemChip itemId={itemId} onOpen={onOpen} />
        {item && <span className="recipe__price">{formatMoney(item.startingValue)}</span>}
      </div>

      {source && (
        <div className="recipe__node-body">
          <div className="recipe__via">
            <MachineBadge source={source} />
            {sources.length > 1 && (
              <Flicker index={Math.min(srcIdx, sources.length - 1)} total={sources.length} onChange={setSrcIdx} label="recipe" />
            )}
          </div>
          {source.kind === 'recipe' && (
            <div className="recipe__children">
              {source.requirements.map((req, i) => (
                <TreeNode
                  key={`${itemId}:${i}`}
                  requirement={req}
                  depth={depth + 1}
                  ancestry={[...ancestry, itemId]}
                  onOpen={onOpen}
                />
              ))}
            </div>
          )}
        </div>
      )}
      {!source && !cyclic && <div className="recipe__leaf">Raw resource</div>}
      {cyclic && <div className="recipe__leaf">↑ see above</div>}
    </div>
  )
}

/** The full production tree for one item, with a back button to the browse list. */
function RecipeTreeView({ rootId, onOpen, onBack }: { rootId: string; onOpen: (id: string) => void; onBack: () => void }) {
  const item = ITEMS_BY_ID[rootId]
  return (
    <div className="recipe__tree">
      <button type="button" className="recipe__back" onClick={onBack}>
        ← All recipes
      </button>
      <div className="recipe__tree-title">
        <Emoji emoji={item?.emoji ?? '❓'} size={22} label={item?.name ?? rootId} />
        <span>{item?.name ?? rootId}</span>
      </div>
      <TreeNode requirement={{ candidates: [rootId] }} depth={0} ancestry={[]} onOpen={onOpen} />
    </div>
  )
}

const q = (s: string) => s.trim().toLowerCase()
const nameOf = (id: string) => ITEMS_BY_ID[id]?.name ?? id

/**
 * The recipe book: a searchable reference split by machine (spawners,
 * processors, combiners, the village hut), where tapping any item opens the
 * full "what's needed to make it" tree — flicking through every food and drink
 * for a villager, and every ingredient wherever a slot accepts more than one.
 */
export function RecipeBook({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)

  const term = q(query)
  const matches = (...ids: string[]) => !term || ids.some((id) => nameOf(id).toLowerCase().includes(term))

  const spawners = useMemo(() => spawnerRows(), [])
  const villageReqs = useMemo(() => villageBrowseRequirements(), [])

  const shownSpawners = spawners.filter((s) => matches(s.outputItem))
  const shownProcessors = RECIPES.processor.filter((r) => matches(r.in, r.out))
  const shownCombiners = RECIPES.combiner.filter((r) => matches(r.a, r.b, r.out))
  const villageShown = matches(VILLAGE_OUTPUT, ...villageReqs.flatMap((r) => r.candidates))

  const anyResults =
    shownSpawners.length + shownProcessors.length + shownCombiners.length > 0 || villageShown

  return (
    <aside className="panel panel--recipe" aria-label="Recipe book">
      <header className="panel__head">
        <span className="panel__title">
          <Emoji emoji="📖" size={18} label="recipe book" /> Recipe Book
        </span>
        <button type="button" className="panel__close" aria-label="Close" onClick={onClose}>
          ✕
        </button>
      </header>

      {selected ? (
        <RecipeTreeView rootId={selected} onOpen={setSelected} onBack={() => setSelected(null)} />
      ) : (
        <>
          <input
            type="search"
            className="market__search"
            placeholder="Search recipes…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search recipes"
          />
          <div className="recipe__list">
            {shownSpawners.length > 0 && (
              <section className="recipe__section">
                <h3 className="recipe__section-head">
                  <Emoji emoji="⛏️" size={13} label="" /> Spawners
                  <span className="recipe__section-hint">produce raw items</span>
                </h3>
                {shownSpawners.map((s) => (
                  <div key={s.catalogId} className="recipe__row">
                    <span className="recipe__machine">
                      <Emoji emoji={machineMeta({ kind: 'spawner', catalogId: s.catalogId }).emoji} size={14} label="" />
                      <span>{machineMeta({ kind: 'spawner', catalogId: s.catalogId }).name}</span>
                    </span>
                    <span className="recipe__arrow">→</span>
                    <ItemChip itemId={s.outputItem} onOpen={setSelected} />
                  </div>
                ))}
              </section>
            )}

            {shownProcessors.length > 0 && (
              <section className="recipe__section">
                <h3 className="recipe__section-head">
                  <Emoji emoji="⚙️" size={13} label="" /> Processors
                  <span className="recipe__section-hint">1 in → 1 out</span>
                </h3>
                {shownProcessors.map((r) => (
                  <div key={`${r.in}-${r.out}`} className="recipe__row">
                    <ItemChip itemId={r.in} onOpen={setSelected} />
                    <span className="recipe__arrow">→</span>
                    <ItemChip itemId={r.out} onOpen={setSelected} />
                  </div>
                ))}
              </section>
            )}

            {shownCombiners.length > 0 && (
              <section className="recipe__section">
                <h3 className="recipe__section-head">
                  <Emoji emoji="🔀" size={13} label="" /> Combiners
                  <span className="recipe__section-hint">2 in → 1 out</span>
                </h3>
                {shownCombiners.map((r) => (
                  <div key={`${r.a}-${r.b}-${r.out}`} className="recipe__row">
                    <ItemChip itemId={r.a} onOpen={setSelected} />
                    <span className="recipe__arrow">+</span>
                    <ItemChip itemId={r.b} onOpen={setSelected} />
                    <span className="recipe__arrow">→</span>
                    <ItemChip itemId={r.out} onOpen={setSelected} />
                  </div>
                ))}
              </section>
            )}

            {villageShown && (
              <section className="recipe__section">
                <h3 className="recipe__section-head">
                  <Emoji emoji="🏘️" size={13} label="" /> Village Hut
                  <span className="recipe__section-hint">food + drink + bed</span>
                </h3>
                <div className="recipe__row recipe__row--wrap">
                  {villageReqs.map((req, i) => (
                    <Fragment key={req.slotLabel ?? i}>
                      {i > 0 && <span className="recipe__arrow">+</span>}
                      {req.candidates.length > 1 ? (
                        <span className="recipe__anyslot" title={`Any ${req.slotLabel?.toLowerCase()}`}>
                          Any {req.slotLabel} ({req.candidates.length})
                        </span>
                      ) : (
                        <ItemChip itemId={req.candidates[0]} onOpen={setSelected} />
                      )}
                    </Fragment>
                  ))}
                  <span className="recipe__arrow">→</span>
                  <ItemChip itemId={VILLAGE_OUTPUT} onOpen={setSelected} />
                </div>
              </section>
            )}

            {!anyResults && <p className="market__empty">No recipes match “{query}”.</p>}
          </div>
        </>
      )}
    </aside>
  )
}
