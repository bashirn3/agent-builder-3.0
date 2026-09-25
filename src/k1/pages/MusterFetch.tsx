import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { ease } from '../../lib/motion'
import { describeError } from '../data/agentConfig'
import { AccessError, fetchMusterDay, importLeads, MUSTER_STATIONS, type LeadRow, type StationStatus } from '../data/builderApi'
import { shortStation } from '../data/fixtures'
import { formatDate } from '../data/language'
import { Select, Spinner } from '../ui/controls'
import { CalendarDays } from '../ui/icons'
import { DateRangeField, isoDay } from '../ui/DateRange'
import { Dialog } from '../ui/overlay'
import { LeadPreview } from './LeadUpload'
import { copy, useCopy } from '../i18n'

const MAX_DAYS = 31

type Notify = (toast: { title: string; body: string; tone?: 'success' | 'error' }) => void
type Phase = 'form' | 'fetching' | 'done'

const STATUS_OPTIONS: StationStatus[] = ['open', 'closed', 'all']

function daysBetween(from: string, to: string) {
  const days: string[] = []
  const cursor = new Date(`${from}T12:00:00`)
  const end = new Date(`${to}T12:00:00`)
  while (cursor <= end && days.length <= MAX_DAYS) {
    days.push(isoDay(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  return days
}

function accessMessage(error: unknown) {
  if (error instanceof AccessError) return error.reason === 'team_required' ? copy().muster.teamOnly : copy().muster.signinAgain
  return null
}

function StatusChoice({ value, onChange, labelId }: { value: StationStatus; onChange: (value: StationStatus) => void; labelId: string }) {
  const t = useCopy()
  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = STATUS_OPTIONS.indexOf(value)
    const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
    if (!delta) return
    event.preventDefault()
    const next = STATUS_OPTIONS[(index + delta + STATUS_OPTIONS.length) % STATUS_OPTIONS.length]
    onChange(next)
    requestAnimationFrame(() => event.currentTarget.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus())
  }
  return (
    <div className="k1-segmented" role="radiogroup" aria-labelledby={labelId} onKeyDown={onKey}>
      {STATUS_OPTIONS.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={value === option}
          tabIndex={value === option ? 0 : -1}
          className={value === option ? 'is-active' : undefined}
          onClick={() => onChange(option)}
        >
          {t.muster.statuses[option]}
        </button>
      ))}
    </div>
  )
}

export function MusterFetchDialog({ open, onClose, onImported, notify }: {
  open: boolean
  onClose: () => void
  onImported: () => void
  notify: Notify
}) {
  const t = useCopy()
  const [stationId, setStationId] = useState<string>(String(MUSTER_STATIONS[0].id))
  const [status, setStatus] = useState<StationStatus>('open')
  const [range, setRange] = useState<{ from: string | null; to: string | null }>({ from: null, to: null })
  const [phase, setPhase] = useState<Phase>('form')
  const [progress, setProgress] = useState({ done: 0, total: 0, day: '' })
  const [rows, setRows] = useState<LeadRow[]>([])
  const [failed, setFailed] = useState<string[]>([])
  const [error, setError] = useState('')
  const [attempted, setAttempted] = useState(false)
  const [importing, setImporting] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const ids = { station: useId(), status: useId(), range: useId(), hint: useId(), error: useId() }

  useEffect(() => () => abort.current?.abort(), [])

  const station = MUSTER_STATIONS.find((item) => String(item.id) === stationId) ?? MUSTER_STATIONS[0]
  const days = range.from && range.to ? daysBetween(range.from, range.to) : []
  const validation = !range.from || !range.to
    ? t.muster.chooseDates
    : days.length > MAX_DAYS ? t.muster.maxMonth : ''
  const shown = (attempted && validation) || error

  const reset = () => {
    abort.current?.abort()
    setPhase('form')
    setRows([])
    setFailed([])
    setError('')
    setAttempted(false)
    setProgress({ done: 0, total: 0, day: '' })
  }

  const close = () => {
    if (importing) return
    reset()
    onClose()
  }

  const run = async () => {
    setAttempted(true)
    setError('')
    if (validation) return
    const controller = new AbortController()
    abort.current = controller
    setPhase('fetching')
    setProgress({ done: 0, total: days.length, day: days[0] })
    const found = new Map<string, LeadRow>()
    const missed: string[] = []
    for (const [index, day] of days.entries()) {
      if (controller.signal.aborted) return
      setProgress({ done: index, total: days.length, day })
      let result = null
      for (let attempt = 0; attempt < 2 && !result; attempt += 1) {
        try {
          result = await fetchMusterDay(day, [station.id], status, controller.signal)
        } catch (failure) {
          if (controller.signal.aborted) return
          const blocked = accessMessage(failure)
          if (blocked) {
            setError(blocked)
            setPhase('form')
            return
          }
        }
      }
      if (!result) missed.push(day)
      else result.items.forEach((row) => found.set(row.PlateNumber.toUpperCase(), row))
    }
    setProgress({ done: days.length, total: days.length, day: days[days.length - 1] })
    setRows([...found.values()].sort((a, b) => a.NextInspectionDateRangeEnd.localeCompare(b.NextInspectionDateRangeEnd)))
    setFailed(missed)
    setPhase('done')
  }

  const stop = () => {
    abort.current?.abort()
    setPhase('form')
  }

  const submit = async () => {
    if (!rows.length) return
    setImporting(true)
    try {
      const { inserted, updated } = await importLeads(rows)
      notify({
        title: t.upload.imported(inserted + updated),
        body: updated ? t.upload.importedUpdated(inserted, updated) : t.upload.importedBody,
      })
      onImported()
      reset()
      onClose()
    } catch (failure) {
      notify({ tone: 'error', title: t.upload.importFailed, body: accessMessage(failure) ?? t.upload.importFailedBody(describeError(failure)) })
    } finally {
      setImporting(false)
    }
  }

  const closedCount = rows.filter((row) => row.isClosed).length
  const percent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <Dialog open={open} title={t.muster.title} onClose={close} width={680}>
      <AnimatePresence mode="wait" initial={false}>
        {phase === 'done' ? (
          <motion.div key="done" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18, ease }}>
            <div className="k1-form-stack">
              <p className="k1-upload__summary" role="status">
                <strong>{t.muster.found(rows.length)}</strong>
                <span> · {shortStation(station.name)} · {formatDate(range.from, 'fi')}–{formatDate(range.to, 'fi')}</span>
                {closedCount > 0 && <span> · {t.muster.closedCount(closedCount)}</span>}
              </p>
              {rows.length > 0 ? <LeadPreview rows={rows} /> : <p className="k1-hint">{t.muster.noneFound}</p>}
              {failed.length > 0 && (
                <p className="k1-hint k1-hint--warn" role="alert">
                  {t.muster.failedDays(failed.length, failed.map((day) => formatDate(day, 'fi')).join(', '))}
                </p>
              )}
            </div>
            <footer className="k1-dialog__foot">
              <button type="button" className="k1-btn k1-btn--outline" onClick={reset} disabled={importing}>{t.muster.changeFilters}</button>
              <button type="button" className="k1-btn k1-btn--primary" onClick={() => void submit()} disabled={!rows.length || importing} aria-busy={importing}>
                {importing && <Spinner />}{rows.length ? t.upload.importCount(rows.length) : t.upload.import}
              </button>
            </footer>
          </motion.div>
        ) : (
          <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.14, ease }}>
            <div className="k1-form-stack">
              <div className="k1-field">
                <label htmlFor={ids.station}>{t.muster.station}</label>
                <Select
                  id={ids.station}
                  value={stationId}
                  placeholder={t.muster.chooseStation}
                  options={MUSTER_STATIONS.map((item) => ({ value: String(item.id), label: shortStation(item.name) }))}
                  onChange={setStationId}
                />
              </div>
              <div className="k1-field">
                <span id={ids.status} className="k1-field__label">{t.muster.status}</span>
                <StatusChoice value={status} onChange={setStatus} labelId={ids.status} />
              </div>
              <div className="k1-field">
                <label htmlFor={ids.range}>{t.muster.due}</label>
                <DateRangeField
                  id={ids.range}
                  future
                  maxDays={MAX_DAYS}
                  from={range.from}
                  to={range.to}
                  ariaLabel={t.muster.dueLabel}
                  leading={<CalendarDays size={15} strokeWidth={1.75} className="k1-select__lead" />}
                  onChange={setRange}
                />
                <p id={ids.hint} className="k1-hint">{t.muster.hint}</p>
              </div>
              {phase === 'fetching' && (
                <div className="k1-fetch" role="status" aria-live="polite">
                  <div className="k1-fetch__bar" aria-hidden="true"><span style={{ width: `${percent}%` }} /></div>
                  <p className="k1-hint">{t.muster.fetching(formatDate(progress.day, 'fi'), Math.min(progress.done + 1, progress.total), progress.total)}</p>
                </div>
              )}
              {shown && <p id={ids.error} className="k1-auth__error" role="alert">{shown}</p>}
            </div>
            <footer className="k1-dialog__foot">
              {phase === 'fetching'
                ? <button type="button" className="k1-btn k1-btn--outline" onClick={stop}>{t.muster.stop}</button>
                : <button type="button" className="k1-btn k1-btn--outline" onClick={close}>{t.common.cancel}</button>}
              <button type="button" className="k1-btn k1-btn--primary" onClick={() => void run()} disabled={phase === 'fetching'} aria-busy={phase === 'fetching'}>
                {phase === 'fetching' && <Spinner />}{t.muster.fetch}
              </button>
            </footer>
          </motion.div>
        )}
      </AnimatePresence>
    </Dialog>
  )
}
