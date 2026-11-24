import { isSample, prodApi } from '../../data/prodApi'
import { useCopy } from '../../i18n'
import { href } from '../../routes'
import { CalendarDays, Check, ChevronRight, Clock, MessageCircle, MessagesSquare, MessageSquareMore } from '../../ui/icons'
import { AreaChart, StatCard } from './charts'
import { Card, CardsSkeleton, DatePill, EmptyState, ErrorState, fmtDay, fmtNum, fmtRate, fmtTime, needsHref, needsTitle, ProdHead, useProdData } from './shared'

export function HomePage() {
  const t = useCopy()
  const p = t.prod.home
  const { data, error, loading, refreshing, reload } = useProdData((signal) => prodApi.home(signal), [], true)

  const onOff = (on: boolean) => (
    <span className="k1-prod-onoff"><span className={`k1-dot${on ? ' is-on' : ''}`} aria-hidden="true" />{on ? t.prod.on : t.prod.off}</span>
  )

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
              points={data.this_week.bookings_per_week.slice(-8).map((week) => ({ key: week.week_start, label: fmtDay(week.week_start), value: week.booked }))}
            />
          </Card>

          <div className="k1-prod-grid k1-prod-grid--two">
            <Card title={p.needsYou}>
              {data.needs_you.length ? (
                <ul className="k1-needs">
                  {data.needs_you.map((item) => (
                    <li key={`${item.kind}-${item.title}`}>
                      <a className={`k1-needs__item k1-needs__item--${item.kind}`} href={needsHref(item.link)}>
                        <span className="k1-needs__mark" aria-hidden="true" />
                        <span>{needsTitle(item)}</span>
                        <ChevronRight size={16} strokeWidth={1.75} />
                      </a>
                    </li>
                  ))}
                </ul>
              ) : <EmptyState title={p.nothingNeeded} />}
            </Card>

            <Card title={p.status}>
              <dl className="k1-prod-facts">
                <div><dt><MessageCircle size={14} />{p.outreach}</dt><dd>{onOff(data.status.outreach_on)}</dd></div>
                <div><dt><MessagesSquare size={14} />{p.bot}</dt><dd>{onOff(data.status.bot_on)}</dd></div>
                <div><dt><Check size={14} />{p.stationsSending}</dt><dd>{data.status.stations_sending} / {data.status.stations_total}</dd></div>
                <div><dt><Clock size={14} />{p.lastSend}</dt><dd>{fmtTime(data.status.last_send_at)}</dd></div>
                <div><dt><MessageSquareMore size={14} />{p.messagesToday}</dt><dd>{fmtNum(data.status.messages_today)}</dd></div>
              </dl>
            </Card>
          </div>

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
