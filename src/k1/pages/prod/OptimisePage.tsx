import { useState } from 'react'
import { isSample, prodApi, type Performance, type Range } from '../../data/prodApi'
import { useCopy } from '../../i18n'
import { CalendarDays, Check, MessagesSquare, Optimise } from '../../ui/icons'
import { BarChart, PieChart, RankTable, StatCard } from './charts'
import { Card, CardsSkeleton, EmptyState, ErrorState, fmtDay, fmtNum, fmtRate, fmtUplift, ProdHead, stepLabel, useProdData } from './shared'

const RANGES: Range[] = ['week', 'month', 'all']
const MIN_SENDS = 10

export function OptimisePage() {
  const t = useCopy()
  const p = t.prod.optimise
  const [range, setRange] = useState<Range>('month')
  const { data, error, loading, refreshing, reload } = useProdData((signal) => prodApi.performance(range, signal), [range])

  return (
    <div className="k1-page k1-prod">
      <ProdHead title={t.nav.optimise} description={t.prod.describe.optimise} sample={isSample('performance')} onRefresh={reload} refreshing={refreshing}>
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
    [t.prod.funnel.read, f.read],
    [t.prod.funnel.replied, f.replied],
    [t.prod.funnel.bookedInChat, f.booked_in_chat],
    [t.prod.funnel.leftList, f.left_list],
  ]
  const top = Math.max(1, f.sent)
  const bestRate = Math.max(0.0001, ...data.by_station.map((row) => row.rate ?? 0))
  return (
    <>
      <div className="k1-stat-cards">
        <StatCard icon={<Check size={14} />} label={t.prod.funnel.delivered} value={fmtNum(f.delivered)} />
        <StatCard icon={<MessagesSquare size={14} />} label={t.prod.funnel.replied} value={fmtNum(f.replied)} />
        <StatCard icon={<CalendarDays size={14} />} label={p.rate} value={fmtRate(f.rate)} hint={p.rateHint(fmtNum(f.converted), fmtNum(f.delivered))} />
        <StatCard icon={<Optimise size={14} />} label={p.uplift} value={fmtUplift(f.uplift)} hint={p.upliftHint(fmtNum(f.holdout_converted), fmtNum(f.holdout))} />
      </div>

      <Card title={p.bookingsPerWeek}>
        <BarChart
          label={p.bookingsPerWeek}
          legend={[p.beforeDeadline, p.afterDeadline]}
          bars={data.bookings_per_week.map((week) => ({ key: week.week_start, label: fmtDay(week.week_start), values: [week.before_deadline, week.after_deadline] }))}
        />
      </Card>

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

function SendHours({ data }: { data: Performance }) {
  const t = useCopy()
  const p = t.prod.optimise
  const cells = data.send_hours.filter((cell) => cell.sends >= MIN_SENDS)
  const hours = [...new Set(cells.map((cell) => cell.hour))].sort((a, b) => a - b)
  const days = [...new Set(cells.map((cell) => cell.weekday))].sort((a, b) => a - b)
  const top = Math.max(0.01, ...cells.map((cell) => cell.reply_rate ?? 0))
  const find = (weekday: number, hour: number) => cells.find((cell) => cell.weekday === weekday && cell.hour === hour)
  return (
    <Card title={p.sendHours} aside={<span className="k1-hint">{p.sendHoursHint(MIN_SENDS)}</span>}>
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
                    const strength = cell?.reply_rate != null ? cell.reply_rate / top : 0
                    return (
                      <td key={hour} title={cell ? p.cellHint(fmtNum(cell.sends), fmtRate(cell.reply_rate)) : undefined}>
                        {cell ? <span style={{ background: `rgba(37, 99, 235, ${0.08 + strength * 0.72})`, color: strength > 0.6 ? '#fff' : undefined }}>{fmtRate(cell.reply_rate)}</span> : <span className="is-empty" />}
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
