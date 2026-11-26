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

export type AreaSeries = { key: string; label: string; color: string; values: number[]; note?: string }

// Chatbase "Chats started": smooth lines over fading fills, gridlines and no y axis. Several series overlay from
// zero, largest drawn first so the smaller ones stay visible in front.
export function AreaChart({ label, x: columns, series, share, footer, scale }: {
  label: string
  x: Array<{ key: string; label: string }>
  series: AreaSeries[]
  share?: boolean
  footer?: (index: number) => ReactNode
  scale?: 'log'
}) {
  const id = useId()
  const hover = useHover(columns.length)
  const width = 1000
  const height = 240
  const single = columns.length === 1
  const plot = (value: number) => scale === 'log' ? Math.log1p(Math.max(0, value)) : value
  const top = Math.max(scale === 'log' ? Math.log1p(1) : 1, ...series.flatMap((item) => item.values.map(plot))) * 1.15
  const xAt = (index: number) => single ? index * width : (index / (columns.length - 1)) * width
  const y = (value: number) => height - (plot(value) / top) * height
  const path = (values: number[]) => {
    const points = single ? [values[0], values[0]] : values
    const line = points.map((value, index) => {
      if (index === 0) return `M ${xAt(0)} ${y(value)}`
      const mid = (xAt(index - 1) + xAt(index)) / 2
      return `C ${mid} ${y(points[index - 1])} ${mid} ${y(value)} ${xAt(index)} ${y(value)}`
    }).join(' ')
    return { line, area: `${line} L ${xAt(points.length - 1)} ${height} L ${xAt(0)} ${height} Z` }
  }
  const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)
  const back = [...series].sort((a, b) => sum(b.values) - sum(a.values))
  const left = (index: number) => single ? 50 : (index / (columns.length - 1)) * 100
  const at = hover.index
  const atTotal = at === null ? 0 : sum(series.map((item) => item.values[at] ?? 0))

  return (
    <figure className="k1-area" aria-label={label}>
      {series.length > 1 && (
        <figcaption className="k1-chart__legend">
          {series.map((item) => <span key={item.key}><i style={{ background: item.color }} />{item.label}{item.note && <b>{item.note}</b>}</span>)}
        </figcaption>
      )}
      <div ref={hover.ref} className="k1-area__plot" onPointerMove={hover.onMove} onPointerLeave={hover.onLeave}>
        {[0, 1, 2, 3, 4].map((line) => <span key={line} className="k1-chart__grid" style={{ top: `${line * 25}%` }} />)}
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
          <defs>
            {series.map((item, index) => (
              <linearGradient key={item.key} id={`${id}-${index}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={item.color} stopOpacity={series.length > 1 ? 0.18 : 0.9} />
                <stop offset="100%" stopColor={item.color} stopOpacity={series.length > 1 ? 0.02 : 0.04} />
              </linearGradient>
            ))}
          </defs>
          {back.map((item) => {
            const { line, area } = path(item.values)
            return (
              <g key={item.key}>
                <path d={area} fill={`url(#${id}-${series.indexOf(item)})`} />
                <path d={line} fill="none" stroke={item.color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
              </g>
            )
          })}
        </svg>
        {at !== null && (
          <>
            <span className="k1-chart__cursor" style={{ left: `${left(at)}%` }} />
            {series.map((item) => <span key={item.key} className="k1-area__dot" style={{ left: `${left(at)}%`, top: `${(y(item.values[at] ?? 0) / height) * 100}%`, borderColor: item.color }} />)}
            <span className={`k1-chart__tip${left(at) > 60 ? ' is-left' : ''}`} style={{ left: `${left(at)}%` }}>
              <small>{columns[at].label}</small>
              {series.length === 1
                ? <strong>{fmtNum(series[0].values[at] ?? 0)}</strong>
                : series.map((item) => (
                  <span key={item.key}>
                    <i style={{ background: item.color }} />{item.label}
                    <b>{fmtNum(item.values[at] ?? 0)}{share && atTotal > 0 && <em> · {Math.round(((item.values[at] ?? 0) / atTotal) * 100)}&nbsp;%</em>}</b>
                  </span>
                ))}
              {footer?.(at)}
            </span>
          </>
        )}
      </div>
      <div className="k1-chart__axis">
        {columns.map((column, index) => <span key={column.key} className={index === 0 || index === columns.length - 1 || index === Math.floor((columns.length - 1) / 2) ? 'is-key' : undefined} style={{ left: `${left(index)}%` }}>{column.label}</span>)}
      </div>
      <table className="k1-sr-only">
        <caption>{label}</caption>
        <thead><tr><th scope="col" />{series.map((item) => <th key={item.key} scope="col">{item.label}</th>)}</tr></thead>
        <tbody>{columns.map((column, index) => <tr key={column.key}><th scope="row">{column.label}</th>{series.map((item) => <td key={item.key}>{item.values[index] ?? 0}</td>)}</tr>)}</tbody>
      </table>
    </figure>
  )
}

// Chatbase "Usage history": columns on gridlines, series stacked bottom to top in the order given.
export function BarChart({ label, x: columns, series, share }: { label: string; x: Array<{ key: string; label: string }>; series: AreaSeries[]; share?: boolean }) {
  const hover = useHover(columns.length)
  const totals = columns.map((_, index) => series.reduce((sum, item) => sum + (item.values[index] ?? 0), 0))
  const top = Math.max(1, ...totals) * 1.1
  const at = hover.index
  const left = (index: number) => ((index + 0.5) / columns.length) * 100

  return (
    <figure className="k1-barchart" aria-label={label}>
      {series.length > 1 && (
        <figcaption className="k1-chart__legend">
          {series.map((item) => <span key={item.key}><i style={{ background: item.color }} />{item.label}{item.note && <b>{item.note}</b>}</span>)}
        </figcaption>
      )}
      <div ref={hover.ref} className="k1-barchart__plot" onPointerMove={hover.onMove} onPointerLeave={hover.onLeave}>
        {[0, 1, 2, 3, 4].map((line) => <span key={line} className="k1-chart__grid" style={{ top: `${line * 25}%` }} />)}
        {columns.map((column, index) => (
          <div key={column.key} className={`k1-barchart__col${at === index ? ' is-active' : ''}`}>
            <div className="k1-barchart__stack" style={{ height: `${(totals[index] / top) * 100}%` }}>
              {series.map((item) => <span key={item.key} style={{ flexGrow: item.values[index] ?? 0, background: item.color }} />)}
            </div>
          </div>
        ))}
        {at !== null && (
          <span className={`k1-chart__tip${left(at) > 60 ? ' is-left' : ''}`} style={{ left: `${left(at)}%` }}>
            <small>{columns[at].label}</small>
            {series.length === 1
              ? <strong>{fmtNum(totals[at])}</strong>
              : series.map((item) => (
                <span key={item.key}>
                  <i style={{ background: item.color }} />{item.label}
                  <b>{fmtNum(item.values[at] ?? 0)}{share && totals[at] > 0 && <em> · {Math.round(((item.values[at] ?? 0) / totals[at]) * 100)}&nbsp;%</em>}</b>
                </span>
              ))}
          </span>
        )}
      </div>
      <div className="k1-chart__axis k1-chart__axis--bars">
        {columns.map((column) => <span key={column.key}>{column.label}</span>)}
      </div>
      <table className="k1-sr-only">
        <caption>{label}</caption>
        <thead><tr><th scope="col" />{series.map((item) => <th key={item.key} scope="col">{item.label}</th>)}</tr></thead>
        <tbody>{columns.map((column, index) => <tr key={column.key}><th scope="row">{column.label}</th>{series.map((item) => <td key={item.key}>{item.values[index] ?? 0}</td>)}</tr>)}</tbody>
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
