import { isSample, prodApi } from '../../data/prodApi'
import { useCopy } from '../../i18n'
import { href } from '../../routes'
import { CalendarDays, Check, MessagesSquare, MessageSquareMore } from '../../ui/icons'
import { AreaChart, StatCard } from './charts'
import { Card, CardsSkeleton, DatePill, ErrorState, fmtDay, fmtEur, fmtNum, fmtRate, ProdHead, useProdData } from './shared'

export function HomePage() {
  const t = useCopy()
  const p = t.prod.home
  const { data, error, loading, refreshing, reload } = useProdData((signal) => prodApi.home(signal), [], true)
  const weeks = data?.this_week.bookings_per_week.slice(-8) ?? []
  const hasDelivered = weeks.some((week) => week.delivered !== undefined)

  return (
    <div className="k1-page k1-prod">
      <ProdHead title={t.nav.homePage} description={t.prod.describe.home} sample={isSample('home')} onRefresh={reload} refreshing={refreshing}>
        {data && <DatePill>{fmtDay(data.this_week.from)} – {fmtDay(data.this_week.to)}</DatePill>}
      </ProdHead>
      {loading ? <CardsSkeleton /> : error && !data ? <ErrorState error={error} onRetry={reload} /> : data && (
        <>
          <div className="k1-stat-cards">
            <StatCard icon={<MessageSquareMore size={14} />} label={t.prod.funnel.sent} value={fmtNum(data.this_week.sent)} />
            <StatCard icon={<Check size={14} />} label={t.prod.funnel.delivered} value={fmtNum(data.this_week.delivered)} />
            <StatCard icon={<MessagesSquare size={14} />} label={t.prod.funnel.replied} value={fmtNum(data.this_week.replied)} />
            <StatCard icon={<CalendarDays size={14} />} label={t.prod.funnel.booked} value={fmtNum(data.this_week.booked)} />
          </div>

          <Card title={p.bookings} aside={<span className="k1-hint">{p.lastWeeks}</span>}>
            <AreaChart
              label={p.bookingsPerWeek}
              x={weeks.map((week) => ({ key: week.week_start, label: fmtDay(week.week_start) }))}
              series={[
                ...(hasDelivered ? [{ key: 'delivered', label: t.prod.funnel.delivered, color: '#93c5fd', values: weeks.map((week) => week.delivered ?? 0) }] : []),
                { key: 'booked', label: t.prod.funnel.booked, color: '#1d4ed8', values: weeks.map((week) => week.booked) },
              ]}
              footer={hasDelivered ? (index) => {
                const week = weeks[index]
                return week.delivered ? <small>{p.weekRate(fmtRate(week.booked / week.delivered))}</small> : null
              } : undefined}
            />
          </Card>

          <div className={data.savings ? 'k1-prod-grid k1-prod-grid--three' : 'k1-prod-grid k1-prod-grid--two'}>
            <Card title={p.bookingRate}>
              <div className="k1-prod-figure">
                <strong>{fmtRate(data.value.rate)}</strong>
                <span>{p.rateLabel}</span>
              </div>
              <span className="k1-rank__bar" aria-hidden="true"><span style={{ width: `${Math.min(1, data.value.rate ?? 0) * 100}%` }} /></span>
              <p className="k1-hint">{p.rateHint(fmtNum(data.value.converted), fmtNum(data.value.delivered_contacts))}</p>
            </Card>

            <Card title={p.leadsLeft} aside={<a className="k1-link" href={href({ page: 'liveLeads' })}>{p.seeLeads}</a>}>
              <div className="k1-prod-figure">
                <strong>{fmtNum(data.leads_left.in_window)}</strong>
                <span>{p.inWindow(data.leads_left.window.min_days, data.leads_left.window.max_days)}</span>
              </div>
              <p className="k1-hint">{p.windowHint}</p>
            </Card>

            {data.savings && (
              <Card title={p.savings}>
                <div className="k1-prod-figure">
                  <strong>{fmtEur(data.savings.eur)}</strong>
                  <span>{p.savingsLabel}</span>
                </div>
              </Card>
            )}
          </div>
        </>
      )}
    </div>
  )
}
