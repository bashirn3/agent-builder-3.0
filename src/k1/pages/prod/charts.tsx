import { useId, useRef, useState, type ReactNode } from 'react'
import { fmtNum } from './shared'

const BLUES = ['#1d4ed8', '#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe', '#dbeafe']

export function StatCard({ icon, label, value, hint }: { icon?: ReactNode; label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="k1-stat-card">
      <span className="k1-stat-card__label">{icon}{label}</span>
      <strong className="k1-stat-card__value">{value}</strong>
      {hint && <small className="k1-stat-card__hint">{hint}</small>}
    </div>
  )
}

function useHover(count: number) {
  const ref = useRef<HTMLDivElement>(null)
  const [index, setIndex] = useState<number | null>(null)
  const onMove = (event: React.PointerEvent) => {
    const box = ref.current?.getBoundingClientRect()
    if (!box || count === 0) return
    const ratio = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width))
    setIndex(count === 1 ? 0 : Math.round(ratio * (count - 1)))
  }
  return { ref, index, onMove, onLeave: () => setIndex(null) }
}

// Chatbase "Chats started": one blue series, smooth line over a fading fill, gridlines and no y axis.
export function AreaChart({ points, label, unit }: { points: Array<{ key: string; label: string; value: number }>; label: string; unit?: (value: number) => string }) {
  const gradient = useId()
  const hover = useHover(points.length)
  const width = 1000
  const height = 240
  const top = Math.max(1, ...points.map((point) => point.value)) * 1.15
  const x = (index: number) => points.length === 1 ? width / 2 : (index / (points.length - 1)) * width
  const y = (value: number) => height - (value / top) * height
  const line = points.map((point, index) => {
    if (index === 0) return `M ${x(0)} ${y(point.value)}`
    const mid = (x(index - 1) + x(index)) / 2
    return `C ${mid} ${y(points[index - 1].value)} ${mid} ${y(point.value)} ${x(index)} ${y(point.value)}`
  }).join(' ')
  const area = `${line} L ${x(points.length - 1)} ${height} L ${x(0)} ${height} Z`
  const active = hover.index !== null ? points[hover.index] : null
  const left = (index: number) => points.length === 1 ? 50 : (index / (points.length - 1)) * 100

  return (
    <figure className="k1-area" aria-label={label}>
      <div ref={hover.ref} className="k1-area__plot" onPointerMove={hover.onMove} onPointerLeave={hover.onLeave}>
        {[0, 1, 2, 3, 4].map((line) => <span key={line} className="k1-chart__grid" style={{ top: `${line * 25}%` }} />)}
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#2563eb" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#2563eb" stopOpacity="0.04" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${gradient})`} />
          <path d={line} fill="none" stroke="#2563eb" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        </svg>
        {active && hover.index !== null && (
          <>
            <span className="k1-chart__cursor" style={{ left: `${left(hover.index)}%` }} />
            <span className="k1-area__dot" style={{ left: `${left(hover.index)}%`, top: `${(y(active.value) / height) * 100}%` }} />
            <span className={`k1-chart__tip${left(hover.index) > 70 ? ' is-left' : ''}`} style={{ left: `${left(hover.index)}%` }}>
              <small>{active.label}</small>
              <strong>{unit ? unit(active.value) : fmtNum(active.value)}</strong>
            </span>
          </>
        )}
      </div>
      <div className="k1-chart__axis">
        {points.map((point, index) => <span key={point.key} className={index === 0 || index === points.length - 1 || index === Math.floor((points.length - 1) / 2) ? 'is-key' : undefined} style={{ left: `${left(index)}%` }}>{point.label}</span>)}
      </div>
      <table className="k1-sr-only">
        <caption>{label}</caption>
        <tbody>{points.map((point) => <tr key={point.key}><th scope="row">{point.label}</th><td>{point.value}</td></tr>)}</tbody>
      </table>
    </figure>
  )
}

// Chatbase "Usage history": solid blue columns on gridlines; a second series stacks in light blue.
export function BarChart({ bars, label, legend }: { bars: Array<{ key: string; label: string; values: number[] }>; label: string; legend?: string[] }) {
  const hover = useHover(bars.length)
  const top = Math.max(1, ...bars.map((bar) => bar.values.reduce((sum, value) => sum + value, 0))) * 1.1
  const active = hover.index !== null ? bars[hover.index] : null
  const left = (index: number) => ((index + 0.5) / bars.length) * 100

  return (
    <figure className="k1-barchart" aria-label={label}>
      {legend && (
        <figcaption className="k1-chart__legend">
          {legend.map((item, index) => <span key={item}><i style={{ background: BLUES[index * 2 + 1] }} />{item}</span>)}
        </figcaption>
      )}
      <div ref={hover.ref} className="k1-barchart__plot" onPointerMove={hover.onMove} onPointerLeave={hover.onLeave}>
        {[0, 1, 2, 3, 4].map((line) => <span key={line} className="k1-chart__grid" style={{ top: `${line * 25}%` }} />)}
        {bars.map((bar, index) => {
          const total = bar.values.reduce((sum, value) => sum + value, 0)
          return (
            <div key={bar.key} className={`k1-barchart__col${hover.index === index ? ' is-active' : ''}`}>
              <div className="k1-barchart__stack" style={{ height: `${(total / top) * 100}%` }}>
                {bar.values.map((value, segment) => <span key={segment} style={{ flexGrow: value, background: BLUES[segment * 2 + 1] }} />)}
              </div>
            </div>
          )
        })}
        {active && hover.index !== null && (
          <span className={`k1-chart__tip${left(hover.index) > 70 ? ' is-left' : ''}`} style={{ left: `${left(hover.index)}%` }}>
            <small>{active.label}</small>
            {active.values.length > 1 && legend
              ? active.values.map((value, segment) => <span key={segment}><i style={{ background: BLUES[segment * 2 + 1] }} />{legend[segment]} <b>{fmtNum(value)}</b></span>)
              : <strong>{fmtNum(active.values.reduce((sum, value) => sum + value, 0))}</strong>}
          </span>
        )}
      </div>
      <div className="k1-chart__axis k1-chart__axis--bars">
        {bars.map((bar) => <span key={bar.key}>{bar.label}</span>)}
      </div>
      <table className="k1-sr-only">
        <caption>{label}</caption>
        <tbody>{bars.map((bar) => <tr key={bar.key}><th scope="row">{bar.label}</th>{bar.values.map((value, index) => <td key={index}>{value}</td>)}</tr>)}</tbody>
      </table>
    </figure>
  )
}

export type RankRow = { key: string; label: ReactNode; value: ReactNode; detail?: ReactNode; share: number }

// Chatbase "Chats by country": label and value on one line, a thin blue bar underneath.
export function RankTable({ head, rows }: { head: [string, string]; rows: RankRow[] }) {
  return (
    <div className="k1-rank" role="table">
      <div className="k1-rank__head" role="row">
        <span role="columnheader">{head[0]}</span>
        <span role="columnheader">{head[1]}</span>
      </div>
      {rows.map((row) => (
        <div key={row.key} className="k1-rank__row" role="row">
          <span className="k1-rank__label" role="cell">{row.label}{row.detail && <small>{row.detail}</small>}</span>
          <span className="k1-rank__value" role="cell">{row.value}</span>
          <span className="k1-rank__bar" aria-hidden="true"><span style={{ width: `${Math.max(0, Math.min(1, row.share)) * 100}%` }} /></span>
        </div>
      ))}
    </div>
  )
}

// Chatbase "Chats by channel": a flat pie in blues, with the legend beside it.
export function PieChart({ slices, label }: { slices: Array<{ key: string; label: string; value: number }>; label: string }) {
  const total = slices.reduce((sum, slice) => sum + slice.value, 0)
  const [active, setActive] = useState<string | null>(null)
  let angle = -Math.PI / 2
  const arcs = slices.map((slice, index) => {
    const sweep = total ? (slice.value / total) * Math.PI * 2 : 0
    const start = angle
    angle += sweep
    const large = sweep > Math.PI ? 1 : 0
    const point = (radians: number) => `${50 + 50 * Math.cos(radians)} ${50 + 50 * Math.sin(radians)}`
    const d = sweep >= Math.PI * 2 - 1e-6 ? null : `M 50 50 L ${point(start)} A 50 50 0 ${large} 1 ${point(angle)} Z`
    return { ...slice, d, color: BLUES[index % BLUES.length] }
  })
  return (
    <figure className="k1-pie" aria-label={label}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        {arcs.map((arc) => arc.d === null
          ? <circle key={arc.key} cx="50" cy="50" r="50" fill={arc.color} />
          : <path key={arc.key} d={arc.d} fill={arc.color} opacity={active && active !== arc.key ? 0.45 : 1} onPointerEnter={() => setActive(arc.key)} onPointerLeave={() => setActive(null)} />)}
      </svg>
      <ul className="k1-pie__legend">
        {arcs.map((arc) => (
          <li key={arc.key} className={active === arc.key ? 'is-active' : undefined} onPointerEnter={() => setActive(arc.key)} onPointerLeave={() => setActive(null)}>
            <i style={{ background: arc.color }} />
            <span>{arc.label}</span>
            <strong>{fmtNum(arc.value)}</strong>
          </li>
        ))}
      </ul>
    </figure>
  )
}
