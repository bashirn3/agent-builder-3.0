import { useEffect, useState } from 'react'
import { cancelBooking, listBookings, type StoredBooking } from '../data/builderApi'
import { useCopy } from '../i18n'
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

export function CalendarPage({ notify }: { notify: (toast: { title: string; body: string; tone?: 'success' | 'error' }) => void }) {
  const t = useCopy()
  const [week, setWeek] = useState(() => monday(new Date()))
  const [station, setStation] = useState<number | null>(null)
  const [bookings, setBookings] = useState<StoredBooking[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cancelling, setCancelling] = useState<string | null>(null)

  const days = Array.from({ length: 7 }, (_, index) => addDays(week, index))

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
        <button type="button" className="k1-btn k1-btn--outline" onClick={() => setWeek(addDays(week, -7))}>{t.calendar.previous}</button>
        <button type="button" className="k1-btn k1-btn--outline" onClick={() => setWeek(monday(new Date()))}>{t.calendar.thisWeek}</button>
        <button type="button" className="k1-btn k1-btn--outline" onClick={() => setWeek(addDays(week, 7))}>{t.calendar.next}</button>
        <div className="k1-segmented" role="group" aria-label={t.calendar.station}>
          {STATIONS.map((option) => (
            <button key={option.label} type="button" className={station === option.id ? 'is-active' : undefined} aria-pressed={station === option.id} onClick={() => setStation(option.id)}>
              {option.id ? option.label : t.calendar.allStations}
            </button>
          ))}
        </div>
      </div>
      {error && <p className="k1-hint" role="alert">{error}</p>}
      {loading ? (
        <div className="k1-calendar" role="status" aria-label={t.calendar.loading}>
          {days.map((day) => (
            <section key={day.toISOString()} className="k1-calendar__day" aria-hidden="true">
              <h2>{day.toLocaleDateString('fi-FI', { weekday: 'short', day: 'numeric', month: 'numeric' })}</h2>
              <Skeleton height={14} width="72%" />
              <Skeleton height={12} width="48%" />
            </section>
          ))}
        </div>
      ) : (
        <div className="k1-calendar">
          {days.map((day) => {
            const key = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Helsinki', year: 'numeric', month: '2-digit', day: '2-digit' }).format(day)
            const items = bookings.filter((booking) => helsinkiDay(booking.startsAt) === key)
            return (
              <section key={key} className="k1-calendar__day" aria-label={day.toLocaleDateString('fi-FI', { weekday: 'long', day: 'numeric', month: 'numeric' })}>
                <h2>{day.toLocaleDateString('fi-FI', { weekday: 'short', day: 'numeric', month: 'numeric' })}</h2>
                {items.length === 0 && <p className="k1-hint">{t.calendar.empty}</p>}
                {items.map((booking) => (
                  <article key={booking.id} className="k1-calendar__booking">
                    <strong>{helsinkiTime(booking.startsAt)} · {booking.plate}</strong>
                    <span>{booking.stationName}</span>
                    <span>{booking.bookingNumber}</span>
                    <button type="button" className="k1-btn k1-btn--outline k1-btn--sm" disabled={cancelling === booking.id} onClick={() => void cancel(booking)}>
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
