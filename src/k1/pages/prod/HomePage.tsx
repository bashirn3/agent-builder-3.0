import { isSample, prodApi } from '../../data/prodApi'
import { useCopy } from '../../i18n'
import { href } from '../../routes'
import { CalendarDays, Check, MessageCircle, MessagesSquare } from '../../ui/icons'
import { AreaChart, StatCard } from './charts'
import { Card, CardsSkeleton, DatePill, ErrorState, fmtDay, fmtNum, fmtRate, ProdHead, useProdData } from './shared'

export function HomePage() {
  const t = useCopy()
  const p = t.prod.home
  const { data, error, loading, refreshing, reload } = useProdData((signal) => prodApi.home(signal), [], true)
  const week = data?.this_week
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Helsinki', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const days = (week?.bookings_per_day ?? []).filter((day) => day.day.slice(0, 10) <= today).slice(-7)
  const byDay = days.length > 0
  const points = byDay
    ? days.map((day) => ({ key: day.day, booked: day.booked, delivered: day.delivered }))
    : (week?.bookings_per_week.slice(-8) ?? []).map((item) => ({ key: item.week_start, booked: item.booked, delivered: item.delivered }))
  const hasDelivered = points.some((point) => point.delivered !== undefined)

  return (
    <div className="k1-page k1-prod">
      <ProdHead title={t.nav.homePage} description={t.prod.describe.home} sample={isSample('home')} onRefresh={reload} refreshing={refreshing}>
        {data && <DatePill>{fmtDay(data.this_week.from)} – {fmtDay(data.this_week.to)}</DatePill>}
      </ProdHead>
      {loading ? <CardsSkeleton /> : error && !data ? <ErrorState error={error} onRetry={reload} /> : data && (
        <>
          <div className="k1-stat-cards">
            <StatCard icon={<Check size={14} />} label={t.prod.funnel.delivered} value={fmtNum(data.this_week.delivered)} />
            <StatCard icon={<MessagesSquare size={14} />} label={t.prod.funnel.replied} value={fmtNum(data.this_week.replied)} />
            <StatCard icon={<CalendarDays size={14} />} label={t.prod.funnel.booked} value={fmtNum(data.this_week.booked_customers ?? data.this_week.booked)} />
            <StatCard icon={<MessageCircle size={14} />} label={t.prod.funnel.bookedThroughChat} value={fmtNum(data.this_week.booked_in_chat ?? data.this_week.booked)} />
          </div>

          <Card title={p.bookings} aside={<span className="k1-hint">{byDay ? p.lastDays : p.lastWeeks}</span>}>
            <AreaChart
              label={byDay ? p.bookingsPerDay : p.bookingsPerWeek}
              scale="log"
              x={points.map((point) => ({ key: point.key, label: fmtDay(point.key) }))}
              series={[
                ...(hasDelivered ? [{ key: 'delivered', label: t.prod.funnel.delivered, color: '#93c5fd', values: points.map((point) => point.delivered ?? 0) }] : []),
                { key: 'booked', label: t.prod.funnel.booked, color: '#1d4ed8', values: points.map((point) => point.booked) },
              ]}
              footer={hasDelivered ? (index) => {
                const point = points[index]
                return point.delivered ? <small>{p.weekRate(fmtRate(point.booked / point.delivered))}</small> : null
              } : undefined}
            />
          </Card>

          <div className="k1-prod-grid k1-prod-grid--two">
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
          </div>
        </>
      )}
    </div>
  )
}
