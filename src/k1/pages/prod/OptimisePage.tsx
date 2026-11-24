import { useState } from 'react'
import { isSample, prodApi, type Performance, type Range, type Step } from '../../data/prodApi'
import { useCopy } from '../../i18n'
import { CalendarDays, Check, Copy, MessagesSquare, Optimise } from '../../ui/icons'
import { BarChart, PieChart, RankTable, StatCard } from './charts'
import { Card, CardsSkeleton, EmptyState, ErrorState, fmtDay, fmtNum, fmtRate, fmtUplift, ProdHead, stepLabel, useProdData } from './shared'

const RANGES: Range[] = ['week', 'month', 'all']
const MIN_SENDS = 10
const UPLIFT_SHOWN_ABOVE = 0.1

type Notify = (toast: { title: string; body: string; tone?: 'success' | 'error' }) => void

const FIELD_GUIDE = [
  'K1 Katsastus WhatsApp outreach: raw performance data from the Optimise page.',
  'Customers whose vehicle inspection deadline is near get a WhatsApp first message and up to 3 reminders, and can book in the chat.',
  'Times and weekdays are Europe/Helsinki. weekday 1 = Monday. week_start is the Monday of the week.',
  'funnel.left_list = customers who dropped off K1\'s daily list (booked or inspected elsewhere); funnel.stops = customers who asked us to stop messaging them in the period.',
  'Rates are fractions from 0 to 1. funnel.rate and by_station.rate = converted / delivered, where converted means booked.',
  'holdout = customers deliberately not messaged (10%); holdout_converted = how many of them booked anyway. uplift = rate minus the hold-out booking rate.',
  'send_hours gives reply_rate and booking_rate for messages sent in that weekday and hour. It lists every cell, including those with few sends; the page only shows cells with 10 or more sends.',
  'by_message.step: opener is the first message, reminder_1 to reminder_3 follow it; reminder_3 goes out after the deadline.',
  'bookings_per_week.by_step counts each booking under the last message the customer got before booking.',
  'A null rate or uplift means there is not enough data yet.',
]

function rawExport(data: Performance, range: Range, rangeLabel: string) {
  return JSON.stringify({
    about: FIELD_GUIDE,
    range: { key: range, label: rangeLabel },
    sample_data: isSample('performance'),
    copied_at: new Date().toISOString(),
    data,
  }, null, 2)
}

export function OptimisePage({ notify }: { notify: Notify }) {
  const t = useCopy()
  const p = t.prod.optimise
  const [range, setRange] = useState<Range>('month')
  const { data, error, loading, refreshing, reload } = useProdData((signal) => prodApi.performance(range, signal), [range])

  const copyAll = () => {
    if (!data) return
    void navigator.clipboard?.writeText(rawExport(data, range, p.ranges[range]))
      .then(() => notify({ title: p.copied, body: p.copiedBody(p.ranges[range]) }))
      .catch(() => notify({ tone: 'error', title: t.common.copyFailed, body: t.common.clipboardBlocked }))
  }

  return (
    <div className="k1-page k1-prod">
      <ProdHead title={t.nav.optimise} description={t.prod.describe.optimise} sample={isSample('performance')} onRefresh={reload} refreshing={refreshing}>
        <button type="button" className="k1-btn k1-btn--outline k1-prod-copy" onClick={copyAll} disabled={!data}>
          <Copy size={14} strokeWidth={1.75} />{p.copyAll}
        </button>
        <div className="k1-segmented" role="group" aria-label={p.range}>
          {RANGES.map((value) => (
            <button key={value} type="button" className={range === value ? 'is-active' : undefined} aria-pressed={range === value} onClick={() => setRange(value)}>{p.ranges[value]}</button>
          ))}
        </div>
      </ProdHead>
      {loading ? <CardsSkeleton /> : error && !data ? <ErrorState error={error} onRetry={reload} /> : data && (
        data.funnel.sent === 0 ? <EmptyState title={p.empty} body={p.emptyBody} /> : <Report data={data} />
      )}
    </div>
  )
}

function Report({ data }: { data: Performance }) {
  const t = useCopy()
  const p = t.prod.optimise
  const f = data.funnel
  const funnel: Array<[string, number]> = [
    [t.prod.funnel.sent, f.sent],
    [t.prod.funnel.delivered, f.delivered],
    [t.prod.funnel.replied, f.replied],
    [t.prod.funnel.bookedInChat, f.booked_in_chat],
    [t.prod.funnel.optOut, f.stops ?? 0],
  ]
  const showUplift = f.uplift != null && f.uplift > UPLIFT_SHOWN_ABOVE
  const top = Math.max(1, f.sent)
  const bestRate = Math.max(0.0001, ...data.by_station.map((row) => row.rate ?? 0))
  return (
    <>
      <div className={showUplift ? 'k1-stat-cards' : 'k1-stat-cards k1-stat-cards--three'}>
        <StatCard icon={<Check size={14} />} label={t.prod.funnel.delivered} value={fmtNum(f.delivered)} />
        <StatCard icon={<MessagesSquare size={14} />} label={t.prod.funnel.replied} value={fmtNum(f.replied)} />
        <StatCard icon={<CalendarDays size={14} />} label={p.rate} value={fmtRate(f.rate)} hint={p.rateHint(fmtNum(f.converted), fmtNum(f.delivered))} />
        {showUplift && <StatCard icon={<Optimise size={14} />} label={p.uplift} value={fmtUplift(f.uplift)} hint={p.upliftHint(fmtNum(f.holdout_converted), fmtNum(f.holdout))} />}
      </div>

      <BookedAfter data={data} />

      <div className="k1-prod-grid k1-prod-grid--two">
        <Card title={p.funnel}>
          <RankTable
            head={[p.stage, p.customers]}
            rows={funnel.map(([label, value]) => ({ key: label, label, value: fmtNum(value), share: value / top }))}
          />
        </Card>
        <Card title={p.byStation}>
          <RankTable
            head={[p.station, p.rate]}
            rows={data.by_station.map((row) => ({
              key: row.station,
              label: row.station,
              detail: p.ofDelivered(fmtNum(row.converted), fmtNum(row.delivered)),
              value: fmtRate(row.rate),
              share: (row.rate ?? 0) / bestRate,
            }))}
          />
        </Card>
      </div>

      <div className="k1-prod-grid k1-prod-grid--two">
        <Card title={p.byMessage}>
          <div className="k1-prod-scroll">
            <table className="k1-table">
              <thead>
                <tr><th scope="col">{p.message}</th><th scope="col" className="k1-table__num">{t.prod.funnel.sent}</th><th scope="col" className="k1-table__num">{t.prod.funnel.replied}</th><th scope="col" className="k1-table__num">{p.converted}</th></tr>
              </thead>
              <tbody>
                {data.by_message.map((row) => (
                  <tr key={row.step} className="is-static">
                    <td>{stepLabel(row.step)}</td>
                    <td className="k1-table__num">{fmtNum(row.sent)}</td>
                    <td className="k1-table__num">{fmtNum(row.replied)}</td>
                    <td className="k1-table__num">{fmtNum(row.converted)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title={p.reasons}>
          {data.reasons.length
            ? <PieChart label={p.reasons} slices={data.reasons.map((reason) => ({ key: reason.label, label: reason.label, value: reason.count }))} />
            : <p className="k1-hint">{p.noReasons}</p>}
        </Card>
      </div>

      <SendHours data={data} />

      <Card title={p.matrix}>
        <div className="k1-prod-scroll">
          <table className="k1-table k1-prod-matrix">
            <thead>
              <tr>
                <th scope="col">{p.week}</th>
                <th scope="col">{p.station}</th>
                {(['eligible', 'sent', 'delivered', 'read', 'replied', 'booked_in_chat', 'left_list', 'converted', 'holdout', 'holdout_converted', 'uplift', 'stops', 'handoffs', 'billable'] as const).map((key) => (
                  <th key={key} scope="col" className="k1-table__num">{p.matrixColumns[key]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.matrix.map((row) => (
                <tr key={`${row.week_start}-${row.station}`} className="is-static">
                  <td>{fmtDay(row.week_start)}</td>
                  <td>{row.station}</td>
                  {([row.eligible, row.sent, row.delivered, row.read, row.replied, row.booked_in_chat, row.left_list, row.converted, row.holdout, row.holdout_converted] as number[]).map((value, index) => (
                    <td key={index} className="k1-table__num">{fmtNum(value)}</td>
                  ))}
                  <td className="k1-table__num">{fmtUplift(row.uplift)}</td>
                  <td className="k1-table__num">{fmtNum(row.stops)}</td>
                  <td className="k1-table__num">{fmtNum(row.handoffs)}</td>
                  <td className="k1-table__num">{fmtNum(row.billable)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  )
}

const STEP_COLORS: Record<Step, string> = { opener: '#1d4ed8', reminder_1: '#3b82f6', reminder_2: '#60a5fa', reminder_3: '#93c5fd' }
const STEPS: Step[] = ['opener', 'reminder_1', 'reminder_2', 'reminder_3']

function BookedAfter({ data }: { data: Performance }) {
  const p = useCopy().prod.optimise
  const weeks = data.bookings_per_week
  const x = weeks.map((week) => ({ key: week.week_start, label: fmtDay(week.week_start) }))
  const byStep = weeks.some((week) => week.by_step)
  const raw = byStep
    ? STEPS.map((step) => ({ key: step, label: step === 'reminder_3' ? p.lastStep : stepLabel(step), color: STEP_COLORS[step], values: weeks.map((week) => week.by_step?.[step] ?? 0) }))
    : [
      { key: 'before', label: p.beforeDeadline, color: STEP_COLORS.opener, values: weeks.map((week) => week.before_deadline) },
      { key: 'after', label: p.afterDeadline, color: STEP_COLORS.reminder_3, values: weeks.map((week) => week.after_deadline) },
    ]
  const total = raw.reduce((sum, item) => sum + item.values.reduce((a, b) => a + b, 0), 0)
  const series = raw.map((item) => ({ ...item, note: total ? `${Math.round((item.values.reduce((a, b) => a + b, 0) / total) * 100)}\u00a0%` : undefined }))
  return (
    <Card title={byStep ? p.bookedAfter : p.bookingsPerWeek} aside={<span className="k1-hint">{p.bookedAfterHint}</span>}>
      <BarChart label={byStep ? p.bookedAfter : p.bookingsPerWeek} x={x} series={series} share />
    </Card>
  )
}

type HourCell = Performance['send_hours'][number]

function SendHours({ data }: { data: Performance }) {
  const p = useCopy().prod.optimise
  const cells = data.send_hours.filter((cell) => cell.sends >= MIN_SENDS)
  const hasBookings = cells.some((cell) => cell.booking_rate !== undefined)
  return (
    <div className="k1-prod-grid k1-prod-grid--two">
      <HourHeat title={p.sendHours} cells={cells} rate={(cell) => cell.reply_rate} hint={p.cellHint} />
      <HourHeat title={p.bookingHours} cells={hasBookings ? cells : []} rate={(cell) => cell.booking_rate ?? null} hint={p.bookingCellHint} />
    </div>
  )
}

function HourHeat({ title, cells, rate, hint }: { title: string; cells: HourCell[]; rate: (cell: HourCell) => number | null; hint: (sends: string, rate: string) => string }) {
  const t = useCopy()
  const p = t.prod.optimise
  const hours = [...new Set(cells.map((cell) => cell.hour))].sort((a, b) => a - b)
  const days = [...new Set(cells.map((cell) => cell.weekday))].sort((a, b) => a - b)
  const top = Math.max(0.01, ...cells.map((cell) => rate(cell) ?? 0))
  const find = (weekday: number, hour: number) => cells.find((cell) => cell.weekday === weekday && cell.hour === hour)
  return (
    <Card title={title} aside={<span className="k1-hint">{p.sendHoursHint(MIN_SENDS)}</span>}>
      {cells.length ? (
        <div className="k1-prod-scroll">
          <table className="k1-heat">
            <thead>
              <tr><th scope="col" />{hours.map((hour) => <th key={hour} scope="col">{String(hour).padStart(2, '0')}</th>)}</tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day}>
                  <th scope="row">{t.prod.weekdays[day - 1]}</th>
                  {hours.map((hour) => {
                    const cell = find(day, hour)
                    const value = cell ? rate(cell) : null
                    const strength = value != null ? value / top : 0
                    return (
                      <td key={hour} title={cell ? hint(fmtNum(cell.sends), fmtRate(value)) : undefined}>
                        {cell ? <span style={{ background: `rgba(37, 99, 235, ${0.08 + strength * 0.72})`, color: strength > 0.6 ? '#fff' : undefined }}>{fmtPercent(value)}</span> : <span className="is-empty" />}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="k1-hint">{p.noSendHours(MIN_SENDS)}</p>}
    </Card>
  )
}

function fmtPercent(rate: number | null) {
  return rate === null || !Number.isFinite(rate) ? '—' : `${Math.round(rate * 100)}\u00a0%`
}
