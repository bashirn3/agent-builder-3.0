import { useEffect, useState } from 'react'
import { cancelBooking, listBookings, type StoredBooking } from '../data/builderApi'
import { locale, useCopy } from '../i18n'
import { ChevronLeft, ChevronRight } from '../ui/icons'
import { Skeleton, Spinner } from '../ui/controls'
import { describeError as explain } from '../data/agentConfig'

const STATIONS = [
  { id: null, label: 'all' },
  { id: 256, label: 'Palokka' },
  { id: 241, label: 'Itäharju' },
] as const

function monday(date: Date) {
  const next = new Date(date)
  const day = next.getDay() || 7
  next.setDate(next.getDate() - day + 1)
  next.setHours(12, 0, 0, 0)
  return next
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function helsinkiDay(iso: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Helsinki', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
}

function helsinkiTime(iso: string) {
  return new Intl.DateTimeFormat('fi-FI', { timeZone: 'Europe/Helsinki', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso))
}

// ISO 8601: the Thursday determines the week-numbering year, including year boundaries.
export function isoWeek(date: Date) {
  const thursday = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate() + 3 - ((date.getDay() + 6) % 7)))
  const year = thursday.getUTCFullYear()
  const firstThursday = new Date(Date.UTC(year, 0, 4))
  const week = 1 + Math.round(((thursday.getTime() - firstThursday.getTime()) / 86400000 - (3 - ((firstThursday.getUTCDay() + 6) % 7))) / 7)
  return { year, week }
}

export function CalendarPage({ notify }: { notify: (toast: { title: string; body: string; tone?: 'success' | 'error' }) => void }) {
  const t = useCopy()
  const [week, setWeek] = useState(() => monday(new Date()))
  const [station, setStation] = useState<number | null>(null)
  const [bookings, setBookings] = useState<StoredBooking[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState<string | null>(null)

  const days = Array.from({ length: 7 }, (_, index) => addDays(week, index))
  const { year, week: weekNumber } = isoWeek(week)
  const today = helsinkiDay(new Date().toISOString())
  const currentWeek = monday(new Date()).getTime() === week.getTime()
  const startLabel = days[0].toLocaleDateString(locale(), { day: 'numeric', month: 'short', ...(days[0].getFullYear() !== year ? { year: 'numeric' } : {}) })
  const endLabel = days[6].toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' })

  const load = () => {
    setLoading(true)
    setError(null)
    const from = addDays(week, -1).toISOString()
    const to = addDays(week, 8).toISOString()
    listBookings(from, to, station)
      .then((result) => {
        if (!result.ok) setError(result.error || t.calendar.unavailable)
        setBookings(result.bookings ?? [])
      })
      .catch((failure) => setError(explain(failure)))
      .finally(() => setLoading(false))
  }

  useEffect(load, [week.getTime(), station])

  const cancel = async (booking: StoredBooking) => {
    setCancelling(booking.id)
    try {
      const result = await cancelBooking(`${booking.groupId}|${booking.reservationUid}|${booking.customerUid ?? ''}`)
      if (!result.ok && !result.success) throw new Error('cancel_failed')
      notify({ title: t.calendar.cancelled, body: booking.bookingNumber || booking.plate })
      load()
    } catch (failure) {
      notify({ tone: 'error', title: t.calendar.cancelFailed, body: explain(failure) })
    } finally {
      setCancelling(null)
    }
  }

  return (
    <div className="k1-page">
      <header className="k1-page__head">
        <h1 className="k1-page-title">{t.calendar.title}</h1>
      </header>
      <div className="k1-calendar__bar">
        <div className="k1-calendar__period" aria-live="polite">
          <h2>{t.calendar.week(weekNumber)} <span>{year}</span></h2>
          <p>{startLabel} – {endLabel}</p>
        </div>
        <div className="k1-calendar__navigation" role="group" aria-label={t.calendar.weekNavigation}>
          <button type="button" className="k1-calendar__nav-button" aria-label={t.calendar.previous} title={t.calendar.previous} onClick={() => setWeek(addDays(week, -7))}><ChevronLeft size={17} /></button>
          <button type="button" className="k1-calendar__nav-button" aria-label={t.calendar.next} title={t.calendar.next} onClick={() => setWeek(addDays(week, 7))}><ChevronRight size={17} /></button>
        </div>
        <button type="button" className="k1-calendar__today-button" disabled={currentWeek} onClick={() => setWeek(monday(new Date()))}>{t.calendar.thisWeek}</button>
        <div className="k1-segmented" role="group" aria-label={t.calendar.station}>
          {STATIONS.map((option) => (
            <button key={option.label} type="button" className={station === option.id ? 'is-active' : undefined} aria-pressed={station === option.id} onClick={() => setStation(option.id)}>
              {option.id ? option.label : t.calendar.allStations}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="k1-calendar__error" role="alert">{error}</p>}
      {loading ? (
        <div className="k1-calendar" role="status" aria-label={t.calendar.loading}>
          {days.map((day) => (
            <section key={day.toISOString()} className="k1-calendar__day" aria-hidden="true">
              <div className="k1-calendar__day-head"><h3><span className="k1-calendar__weekday">{day.toLocaleDateString(locale(), { weekday: 'short' })}</span> <span className="k1-calendar__date">{day.toLocaleDateString(locale(), { day: 'numeric', month: 'short' })}</span></h3></div>
              <Skeleton height={14} width="72%" />
            </section>
          ))}
        </div>
      ) : (
        <div className="k1-calendar">
          {days.map((day) => {
            const key = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Helsinki', year: 'numeric', month: '2-digit', day: '2-digit' }).format(day)
            const items = bookings.filter((booking) => helsinkiDay(booking.startsAt) === key).sort((a, b) => a.startsAt.localeCompare(b.startsAt))
            return (
              <section key={key} className={`k1-calendar__day${key === today ? ' is-today' : ''}`} aria-label={day.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}>
                <div className="k1-calendar__day-head">
                  <h3><span className="k1-calendar__weekday">{day.toLocaleDateString(locale(), { weekday: 'short' })}</span> <span className="k1-calendar__date">{day.toLocaleDateString(locale(), { day: 'numeric', month: 'short' })}</span></h3>
                  {items.length > 0 && <span className="k1-calendar__count" aria-label={t.calendar.bookingCount(items.length)}>{items.length}</span>}
                </div>
                {items.length === 0 && !error && <p className="k1-calendar__empty">{t.calendar.empty}</p>}
                {items.map((booking) => (
                  <article key={booking.id} className="k1-calendar__booking">
                    <div className="k1-calendar__booking-head"><time dateTime={booking.startsAt}>{helsinkiTime(booking.startsAt)}</time><strong>{booking.plate}</strong></div>
                    <span className="k1-calendar__station" title={booking.stationName}>{booking.stationName}</span>
                    {booking.bookingNumber && <span className="k1-calendar__reference">{booking.bookingNumber}</span>}
                    <button type="button" className="k1-calendar__cancel" disabled={cancelling === booking.id} aria-label={`${t.calendar.cancel}: ${booking.plate}, ${helsinkiTime(booking.startsAt)}`} onClick={() => void cancel(booking)}>
                      {cancelling === booking.id && <Spinner />}{t.calendar.cancel}
                    </button>
                  </article>
                ))}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
