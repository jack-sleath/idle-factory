import { useMemo, useState } from 'react'
import { CATALOG, ITEMS } from '../data'
import { scalingReport, type ScalingOverrides } from '../game/scaling'
import { formatDuration, formatMoney, formatShort } from '../lib/format'

const MACHINE_IDS = ['processor-basic', 'combiner-basic', 'seller-basic', 'belt-basic']

type Category = 'price' | 'cost' | 'rateTicks'

/** Min + step for a field, derived from its default. Max is dynamic (see Tuner). */
function bounds(kind: Category, def: number) {
  if (kind === 'rateTicks') return { min: 1, step: 1, floor: 2 }
  const step = def >= 100 ? 5 : def >= 10 ? 1 : 0.1
  return { min: 0, step, floor: 1 }
}

/**
 * A label + drag slider + number box, all bound to one value. The slider's max
 * tracks 4× the current value and re-scales when you release the drag (or leave
 * the number box): raising the value grows the range, lowering it shrinks it, so
 * the handle always lands with headroom to push further.
 */
function Tuner({
  label,
  kind,
  def,
  value,
  onChange,
}: {
  label: string
  kind: Category
  def: number
  value: number
  onChange: (n: number) => void
}) {
  const { min, step, floor } = bounds(kind, def)
  const [max, setMax] = useState(() => Math.max(4 * def, floor))
  const rescale = () => setMax(Math.max(4 * value, floor))
  return (
    <label className="admin__row">
      <span className="admin__rowLabel" title={label}>
        {label}
      </span>
      <input
        type="range"
        className="admin__slider"
        min={min}
        max={Math.max(max, value)}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={rescale}
        onKeyUp={rescale}
      />
      <input
        type="number"
        className="admin__num"
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onBlur={rescale}
      />
    </label>
  )
}

/**
 * Dev-only economy tuning screen (milestone-power-scaling). Gated behind the
 * `#admin` hash so it never shows for players. Drag the sliders (or type) to
 * change prices / costs / rates and watch the analytical scaling model recompute
 * live; export the changes as JSON to paste back into the data files. Overrides
 * are in-memory only.
 */
export function AdminScreen({ onClose }: { onClose: () => void }) {
  const [ov, setOv] = useState<ScalingOverrides>({ price: {}, cost: {}, rateTicks: {} })
  const report = useMemo(() => scalingReport(ov), [ov])

  const spawners = CATALOG.filter((c) => c.kind === 'spawner')

  // Set an override, or drop it when the value returns to the data default so
  // the export only ever contains real changes.
  const set = (cat: Category, id: string, n: number, def: number) => {
    setOv((prev) => {
      const map = { ...(prev[cat] as Record<string, number>) }
      if (Number.isNaN(n) || Math.abs(n - def) < 1e-9) delete map[id]
      else map[id] = n
      return { ...prev, [cat]: map }
    })
  }
  const val = (cat: Category, id: string, def: number) => (ov[cat] as Record<string, number>)[id] ?? def

  const exportJson = JSON.stringify(
    Object.fromEntries(
      (Object.entries(ov) as [Category, Record<string, number>][]).filter(([, m]) => Object.keys(m).length),
    ),
    null,
    2,
  )

  return (
    <div className="admin">
      <header className="admin__bar">
        <strong>⚙️ Economy tuning</strong>
        <span className="admin__hint">Dev only (#admin). Drag to fiddle; overrides are in-memory, export to keep them.</span>
        <button type="button" className="save__btn" onClick={() => setOv({ price: {}, cost: {}, rateTicks: {} })}>
          Reset
        </button>
        <button type="button" className="save__btn" onClick={onClose}>
          Close
        </button>
      </header>

      <div className="admin__body">
        <section className="admin__col">
          <h3>Results</h3>
          <dl className="admin__stats">
            <dt>Time to full automation</dt>
            <dd>{formatDuration(report.timeToFullMs)} ({formatShort(report.timeToFullTicks)} ticks)</dd>
            <dt>Items auto-sold</dt>
            <dd>{report.targetCount}</dd>
            <dt>Total build cost</dt>
            <dd>{formatMoney(report.totalBuildCost)}</dd>
            <dt>Bootstrap income / tick</dt>
            <dd>{formatMoney(report.bootstrapIncomePerTick)}</dd>
            <dt>Full income / tick</dt>
            <dd>{formatMoney(report.fullIncomePerTick)}</dd>
          </dl>

          <h3>Unlock timeline</h3>
          <ol className="admin__timeline">
            {report.timeline.map((t) => (
              <li key={t.item}>
                <span>{t.item}</span>
                <span className="admin__muted">{formatDuration(t.atMs)}</span>
              </li>
            ))}
          </ol>

          <h3>Export tuned values</h3>
          <textarea className="admin__export" readOnly rows={6} value={exportJson || '{}'} />
        </section>

        <section className="admin__col">
          <h3>Machine costs</h3>
          {MACHINE_IDS.map((id) => {
            const def = CATALOG.find((c) => c.id === id)?.cost ?? 0
            return (
              <Tuner
                key={id}
                label={id}
                kind="cost"
                def={def}
                value={val('cost', id, def)}
                onChange={(n) => set('cost', id, n, def)}
              />
            )
          })}

          <h3>Spawners</h3>
          {spawners.map((c) => (
            <div key={c.id} className="admin__spawner">
              <div className="admin__spawnerName">{c.name}</div>
              <Tuner
                label="cost"
                kind="cost"
                def={c.cost}
                value={val('cost', c.id, c.cost)}
                onChange={(n) => set('cost', c.id, n, c.cost)}
              />
              <Tuner
                label="rateTicks"
                kind="rateTicks"
                def={c.rateTicks ?? 1}
                value={val('rateTicks', c.id, c.rateTicks ?? 1)}
                onChange={(n) => set('rateTicks', c.id, n, c.rateTicks ?? 1)}
              />
            </div>
          ))}
        </section>

        <section className="admin__col">
          <h3>Item prices</h3>
          {ITEMS.map((it) => (
            <Tuner
              key={it.id}
              label={it.name}
              kind="price"
              def={it.startingValue}
              value={val('price', it.id, it.startingValue)}
              onChange={(n) => set('price', it.id, n, it.startingValue)}
            />
          ))}
        </section>
      </div>
    </div>
  )
}
