import { isSample, prodApi } from '../../data/prodApi'
import { useCopy } from '../../i18n'
import { href } from '../../routes'
import { ChevronRight } from '../../ui/icons'
import { Bars, Card, CardsSkeleton, EmptyState, ErrorState, fmtDay, fmtNum, fmtRate, fmtTime, needsHref, needsTitle, ProdHead, Stat, useProdData } from './shared'

export function HomePage() {
  const t = useCopy()
  const p = t.prod.home
  const { data, error, loading, refreshing, reload } = useProdData((signal) => prodApi.home(signal), [], true)

  return (
    <div className="k1-page k1-prod">
      <ProdHead title={t.nav.homePage} sample={isSample('home')} onRefresh={reload} refreshing={refreshing} />
      {loading ? <CardsSkeleton /> : error && !data ? <ErrorState error={error} onRetry={reload} /> : data && (
        <>
          <section className="k1-prod-strip" aria-label={p.status}>
            <div className="k1-prod-strip__item">
              <span>{p.outreach}</span>
              <strong><span className={`k1-dot${data.status.outreach_on ? ' is-on' : ''}`} aria-hidden="true" />{data.status.outreach_on ? t.prod.on : t.prod.off}</strong>
            </div>
            <div className="k1-prod-strip__item">
              <span>{p.bot}</span>
              <strong><span className={`k1-dot${data.status.bot_on ? ' is-on' : ''}`} aria-hidden="true" />{data.status.bot_on ? t.prod.on : t.prod.off}</strong>
            </div>
            <div className="k1-prod-strip__item">
              <span>{p.stationsSending}</span>
              <strong>{data.status.stations_sending} / {data.status.stations_total}</strong>
            </div>
            <div className="k1-prod-strip__item">
              <span>{p.lastSend}</span>
              <strong>{fmtTime(data.status.last_send_at)}</strong>
            </div>
            <div className="k1-prod-strip__item">
              <span>{p.messagesToday}</span>
              <strong>{fmtNum(data.status.messages_today)}</strong>
            </div>
          </section>

          <div className="k1-prod-grid k1-prod-grid--home">
            <Card title={p.needsYou} className="k1-prod-card--needs">
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

            <Card title={p.thisWeek} aside={<span className="k1-hint">{fmtDay(data.this_week.from)} – {fmtDay(data.this_week.to)}</span>} className="k1-prod-card--week">
              <div className="k1-prod-stats">
                <Stat label={t.prod.funnel.sent} value={fmtNum(data.this_week.sent)} />
                <Stat label={t.prod.funnel.delivered} value={fmtNum(data.this_week.delivered)} />
                <Stat label={t.prod.funnel.replied} value={fmtNum(data.this_week.replied)} />
                <Stat label={t.prod.funnel.booked} value={fmtNum(data.this_week.booked)} />
              </div>
              <Bars
                label={p.bookingsPerWeek}
                bars={data.this_week.bookings_per_week.slice(-8).map((week) => ({ key: week.week_start, label: fmtDay(week.week_start), values: [week.booked] }))}
              />
              <p className="k1-hint">{p.bookingsPerWeek}</p>
            </Card>

            <Card title={p.bookingRate}>
              <Stat label={p.rateLabel} value={fmtRate(data.value.rate)} hint={p.rateHint(fmtNum(data.value.converted), fmtNum(data.value.delivered_contacts))} />
            </Card>

            <Card title={p.leadsLeft} aside={<a className="k1-link" href={href({ page: 'liveLeads' })}>{p.seeLeads}</a>}>
              <Stat label={p.inWindow(data.leads_left.window.min_days, data.leads_left.window.max_days)} value={fmtNum(data.leads_left.in_window)} hint={p.windowHint} />
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
