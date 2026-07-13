import { useMemo, useState } from 'react'
import { CATALOG, ITEMS } from '../data'
import { scalingReport, type ScalingOverrides } from '../game/scaling'
import { formatDuration, formatMoney, formatShort } from '../lib/format'

const MACHINE_IDS = ['processor-basic', 'combiner-basic', 'seller-basic', 'belt-basic']

type Category = 'price' | 'cost' | 'rateTicks'

/**
 * Dev-only economy tuning screen (milestone-power-scaling). Gated behind the
 * `#admin` hash so it never shows for players. Edit prices / costs / rates and
 * watch the analytical scaling model recompute live; export the changes as JSON
 * to paste back into the data files. Overrides are in-memory only.
 */
export function AdminScreen({ onClose }: { onClose: () => void }) {
  const [ov, setOv] = useState<ScalingOverrides>({ price: {}, cost: {}, rateTicks: {} })
  const report = useMemo(() => scalingReport(ov), [ov])

  const spawners = CATALOG.filter((c) => c.kind === 'spawner')

  const set = (cat: Category, id: string, raw: string) => {
    setOv((prev) => {
      const next = { ...prev, [cat]: { ...prev[cat] } }
      const map = next[cat] as Record<string, number>
      const n = Number(raw)
      if (raw === '' || Number.isNaN(n)) delete map[id]
      else map[id] = n
      return next
    })
  }

  // Only keep non-empty override maps in the export.
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
        <span className="admin__hint">Dev only (#admin). Overrides are in-memory; export to keep them.</span>
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
          {MACHINE_IDS.map((id) => (
            <label key={id} className="admin__row">
              <span>{id}</span>
              <input
                type="number"
                defaultValue={CATALOG.find((c) => c.id === id)?.cost ?? 0}
                onChange={(e) => set('cost', id, e.target.value)}
              />
            </label>
          ))}

          <h3>Spawners</h3>
          {spawners.map((c) => (
            <div key={c.id} className="admin__spawner">
              <div className="admin__spawnerName">{c.name}</div>
              <label className="admin__row">
                <span>cost</span>
                <input type="number" defaultValue={c.cost} onChange={(e) => set('cost', c.id, e.target.value)} />
              </label>
              <label className="admin__row">
                <span>rateTicks</span>
                <input type="number" defaultValue={c.rateTicks ?? 0} onChange={(e) => set('rateTicks', c.id, e.target.value)} />
              </label>
            </div>
          ))}
        </section>

        <section className="admin__col">
          <h3>Item prices</h3>
          {ITEMS.map((it) => (
            <label key={it.id} className="admin__row">
              <span>{it.name}</span>
              <input
                type="number"
                step="0.1"
                defaultValue={it.startingValue}
                onChange={(e) => set('price', it.id, e.target.value)}
              />
            </label>
          ))}
        </section>
      </div>
    </div>
  )
}
