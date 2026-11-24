import { useEffect, useMemo, useState } from 'react'
import { isSample, ProdError, prodApi, type Batch, type Controls, type Settings, type SettingsPatch, type Timing } from '../../data/prodApi'
import { copy, useCopy } from '../../i18n'
import { Spinner, Switch } from '../../ui/controls'
import { DayRange } from '../../ui/DayRange'
import { Dialog } from '../../ui/overlay'
import { Card, CardsSkeleton, ErrorState, fmtDay, fmtNum, fmtTime, ProdHead, prodMessage, stepLabel, useProdData } from './shared'

type Notify = (toast: { title: string; body: string; tone?: 'success' | 'error' }) => void
type Plan = Pick<Settings, 'window' | 'timing' | 'daily_cap' | 'sending_hours'>
type Confirm = { kind: 'bot' | 'outreach' } | { kind: 'release'; batch: Batch }

const TIMING: Array<keyof Timing> = ['reminder_1_days_before', 'reminder_2_days_before', 'reminder_3_days_after', 'gap_after_opener_days', 'gap_between_days']
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7]
const HOURS = Array.from({ length: 25 }, (_, hour) => `${String(hour).padStart(2, '0')}:00`)

const planOf = (controls: Controls): Plan => ({
  window: controls.window,
  timing: controls.timing,
  daily_cap: controls.daily_cap,
  sending_hours: controls.sending_hours,
})

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function failure(error: unknown) {
  return error instanceof ProdError ? prodMessage(error) : copy().prod.errors.generic('request_failed')
}

export function ControlPage({ notify }: { notify: Notify }) {
  const t = useCopy()
  const p = t.prod.control
  const { data, setData, error, loading, refreshing, reload } = useProdData((signal) => prodApi.controls(signal), [])
  const [plan, setPlan] = useState<Plan | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)
  const [inWindow, setInWindow] = useState<number | null>(null)

  useEffect(() => { if (data) setPlan(planOf(data)) }, [data])

  const editable = Boolean(data?.can_edit)
  const busy = saving !== null
  const range = plan?.window

  useEffect(() => {
    if (!range) return
    const controller = new AbortController()
    setInWindow(null)
    const timer = setTimeout(() => {
      prodApi.leads({ min_days: range.min_days, max_days: range.max_days, limit: 1 }, controller.signal)
        .then((list) => setInWindow(list.total ?? Object.values(list.bands).reduce((sum, count) => sum + count, 0)))
        .catch(() => { if (!controller.signal.aborted) setInWindow(null) })
    }, 250)
    return () => { clearTimeout(timer); controller.abort() }
  }, [range?.min_days, range?.max_days])

  const patch = useMemo<SettingsPatch>(() => {
    if (!data || !plan) return {}
    const saved = planOf(data)
    return Object.fromEntries((Object.keys(plan) as Array<keyof Plan>).filter((key) => !same(plan[key], saved[key])).map((key) => [key, plan[key]]))
  }, [data, plan])
  const dirty = Object.keys(patch).length > 0

  const save = async (change: SettingsPatch, key: string, success: { title: string; body: string }) => {
    setSaving(key)
    try {
      const next = await prodApi.saveControls(change)
      setData(next)
      notify(success)
    } catch (error) {
      notify({ tone: 'error', title: p.notSaved, body: failure(error) })
    } finally {
      setSaving(null)
    }
  }

  const toggleMaster = (field: 'outreach_on' | 'bot_on', on: boolean) => {
    if (!on) {
      setConfirm({ kind: field === 'bot_on' ? 'bot' : 'outreach' })
      return
    }
    void save({ [field]: true }, field, { title: p.saved, body: field === 'bot_on' ? p.botOnDone : p.outreachOnDone })
  }

  const toggleStation = (id: number, field: 'first_messages_on' | 'reminders_on', on: boolean) => {
    if (!data) return
    const stations = data.stations.map((station) => station.id === id ? { ...station, [field]: on } : station)
    void save({ stations }, `station-${id}-${field}`, { title: p.saved, body: p.atOnce })
  }

  const runBatch = async (batch: Batch, action: 'release' | 'hold') => {
    setSaving(action)
    try {
      const result = await (action === 'release' ? prodApi.releaseBatch(batch.id) : prodApi.holdBatch(batch.id)) as Batch & { batch?: Batch }
      const next = result.batch ?? result
      setData((current) => current && { ...current, batch: { ...batch, ...next, by_station: next.by_station ?? batch.by_station, by_message: next.by_message ?? batch.by_message } })
      notify({ title: action === 'release' ? p.released : p.held, body: action === 'release' ? p.releasedBody(batch.total) : p.heldBody })
    } catch (error) {
      notify({ tone: 'error', title: p.notSaved, body: failure(error) })
    } finally {
      setSaving(null)
    }
  }

  const onConfirm = () => {
    if (!confirm) return
    const current = confirm
    setConfirm(null)
    if (current.kind === 'release') void runBatch(current.batch, 'release')
    else {
      const field = current.kind === 'bot' ? 'bot_on' : 'outreach_on'
      void save({ [field]: false }, field, { title: p.saved, body: current.kind === 'bot' ? p.botOffDone : p.outreachOffDone })
    }
  }

  const setTiming = (key: keyof Timing, value: string) => {
    const number = Math.max(0, Math.min(60, Math.round(Number(value) || 0)))
    setPlan((current) => current && { ...current, timing: { ...current.timing, [key]: number } })
  }

  const toggleDay = (day: number) => setPlan((current) => {
    if (!current) return current
    const days = current.sending_hours.days.includes(day) ? current.sending_hours.days.filter((value) => value !== day) : [...current.sending_hours.days, day].sort()
    return { ...current, sending_hours: { ...current.sending_hours, days } }
  })

  const hoursValid = plan ? plan.sending_hours.from < plan.sending_hours.to && plan.sending_hours.days.length > 0 : true
  const capValid = plan ? plan.daily_cap >= 0 && plan.daily_cap <= 1000 : true

  const confirmCopy = confirm?.kind === 'bot'
    ? { title: p.botOffTitle, body: p.botOffBody, action: p.turnOff }
    : confirm?.kind === 'outreach'
      ? { title: p.outreachOffTitle, body: p.outreachOffBody, action: p.turnOff }
      : confirm?.kind === 'release'
        ? { title: p.releaseTitle, body: p.releaseBody(confirm.batch.total), action: p.release }
        : null

  return (
    <div className="k1-page k1-prod">
      <ProdHead title={t.nav.control} sample={isSample('controls')} preview={t.prod.previewControl} onRefresh={reload} refreshing={refreshing} />
      {loading ? <CardsSkeleton cards={3} /> : error && !data ? <ErrorState error={error} onRetry={reload} /> : data && plan && (
        <>
          {!editable && <p className="k1-prod-note" role="note">{p.readOnly}</p>}

          <div className="k1-prod-grid k1-prod-grid--control">
            <Card title={p.sending}>
              <div className="k1-prod-switches">
                <SwitchRow label={p.outreach} hint={p.outreachHint} checked={data.outreach_on} disabled={!editable || busy} pending={saving === 'outreach_on'} onChange={(on) => toggleMaster('outreach_on', on)} />
                <SwitchRow label={p.bot} hint={p.botHint} checked={data.bot_on} disabled={!editable || busy} pending={saving === 'bot_on'} onChange={(on) => toggleMaster('bot_on', on)} />
              </div>
              <p className="k1-hint">{p.atOnce}</p>
            </Card>

            <Card title={p.stations}>
              <table className="k1-table k1-prod-stations">
                <thead>
                  <tr><th scope="col">{p.station}</th><th scope="col">{p.firstMessages}</th><th scope="col">{p.reminders}</th></tr>
                </thead>
                <tbody>
                  {data.stations.map((station) => (
                    <tr key={station.id}>
                      <th scope="row">{station.name}<span className="k1-hint k1-prod-stations__id">{station.id}</span></th>
                      <td><Switch checked={station.first_messages_on} disabled={!editable || busy} label={p.firstMessagesAt(station.name)} onChange={(on) => toggleStation(station.id, 'first_messages_on', on)} /></td>
                      <td><Switch checked={station.reminders_on} disabled={!editable || busy} label={p.remindersAt(station.name)} onChange={(on) => toggleStation(station.id, 'reminders_on', on)} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>

          <Card title={p.planning} aside={<span className="k1-tag">{p.nextRun}</span>} className="k1-prod-plan">
            <fieldset className="k1-prod-plan__body" disabled={!editable || busy}>
              <div className="k1-prod-window">
                <div className="k1-prod-window__head">
                  <span className="k1-label">{p.window}</span>
                  <span className="k1-prod-window__value">
                    {t.prod.days(plan.window.min_days, plan.window.max_days)}
                    <span className="k1-prod-window__count">{inWindow === null ? <Spinner size={12} /> : p.leadsInWindow(fmtNum(inWindow))}</span>
                  </span>
                </div>
                <DayRange
                  min={plan.window.min_days}
                  max={plan.window.max_days}
                  disabled={!editable || busy}
                  onChange={(next) => setPlan((current) => current && { ...current, window: { min_days: next.min, max_days: next.max } })}
                  label={{ from: t.prod.fromDays, to: t.prod.toDays }}
                />
                <p className="k1-hint">{p.windowHint}</p>
              </div>

              <div className="k1-prod-fields">
                {TIMING.map((key) => (
                  <label key={key} className="k1-field">
                    <span>{p.timing[key]}</span>
                    <span className="k1-prod-number">
                      <input className="k1-input" type="number" min={0} max={60} inputMode="numeric" value={plan.timing[key]} onChange={(event) => setTiming(key, event.target.value)} />
                      <span>{p.dayUnit}</span>
                    </span>
                  </label>
                ))}
                <label className="k1-field">
                  <span>{p.dailyCap}</span>
                  <span className="k1-prod-number">
                    <input className="k1-input" type="number" min={0} max={1000} inputMode="numeric" value={plan.daily_cap} aria-invalid={!capValid} onChange={(event) => setPlan((current) => current && { ...current, daily_cap: Math.max(0, Math.round(Number(event.target.value) || 0)) })} />
                    <span>{p.perDay}</span>
                  </span>
                </label>
              </div>

              <div className="k1-prod-hours">
                <span className="k1-label">{p.hours}</span>
                <div className="k1-prod-days" role="group" aria-label={p.hours}>
                  {WEEKDAYS.map((day) => (
                    <button key={day} type="button" className={`k1-prod-day${plan.sending_hours.days.includes(day) ? ' is-active' : ''}`} aria-pressed={plan.sending_hours.days.includes(day)} onClick={() => toggleDay(day)}>
                      {t.prod.weekdays[day - 1]}
                    </button>
                  ))}
                </div>
                <div className="k1-prod-hours__range">
                  <select className="k1-input" aria-label={p.from} value={plan.sending_hours.from} onChange={(event) => setPlan((current) => current && { ...current, sending_hours: { ...current.sending_hours, from: event.target.value } })}>
                    {HOURS.slice(0, 24).map((hour) => <option key={hour} value={hour}>{hour}</option>)}
                  </select>
                  <span>–</span>
                  <select className="k1-input" aria-label={p.to} value={plan.sending_hours.to} onChange={(event) => setPlan((current) => current && { ...current, sending_hours: { ...current.sending_hours, to: event.target.value } })}>
                    {HOURS.slice(1).map((hour) => <option key={hour} value={hour}>{hour}</option>)}
                  </select>
                  <span className="k1-hint">{p.finnishTime}</span>
                </div>
                {!hoursValid && <p className="k1-field__error">{p.hoursInvalid}</p>}
              </div>

              <div className="k1-prod-readonly">
                <span className="k1-label">{p.holdout}</span>
                <strong>{data.holdout_percent} %</strong>
                <span className="k1-hint">{p.holdoutHint}</span>
              </div>
            </fieldset>
            <footer className="k1-prod-plan__foot">
              <p className="k1-hint">{p.nextRunHint}</p>
              <button type="button" className="k1-btn k1-btn--outline" disabled={!dirty || busy} onClick={() => setPlan(planOf(data))}>{p.discard}</button>
              <button
                type="button"
                className="k1-btn k1-btn--primary"
                disabled={!editable || !dirty || busy || !hoursValid || !capValid}
                aria-busy={saving === 'plan'}
                onClick={() => void save(patch, 'plan', { title: p.saved, body: p.nextRunHint })}
              >
                {saving === 'plan' && <Spinner />}{p.save}
              </button>
            </footer>
          </Card>

          <div className="k1-prod-grid k1-prod-grid--control">
            <BatchCard
              controls={data}
              editable={editable}
              busy={saving}
              onRelease={(batch) => setConfirm({ kind: 'release', batch })}
              onHold={(batch) => void runBatch(batch, 'hold')}
            />
            <Card title={p.history}>
              {data.history.length ? (
                <table className="k1-table">
                  <thead>
                    <tr><th scope="col">{p.date}</th><th scope="col" className="k1-table__num">{t.prod.funnel.sent}</th><th scope="col" className="k1-table__num">{t.prod.funnel.delivered}</th><th scope="col" className="k1-table__num">{p.failed}</th></tr>
                  </thead>
                  <tbody>
                    {data.history.map((day) => (
                      <tr key={day.date} className="is-static">
                        <td>{fmtDay(day.date)}</td>
                        <td className="k1-table__num">{fmtNum(day.sent)}</td>
                        <td className="k1-table__num">{fmtNum(day.delivered)}</td>
                        <td className={`k1-table__num${day.failed ? ' k1-prod-fail' : ''}`}>{fmtNum(day.failed)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="k1-hint">{p.noHistory}</p>}
            </Card>
          </div>
        </>
      )}

      <Dialog open={Boolean(confirmCopy)} title={confirmCopy?.title ?? ''} onClose={() => setConfirm(null)} width={460}>
        <p className="k1-dialog__text">{confirmCopy?.body}</p>
        <footer className="k1-dialog__foot">
          <button type="button" className="k1-btn k1-btn--outline" onClick={() => setConfirm(null)}>{t.common.cancel}</button>
          <button type="button" className={`k1-btn ${confirm?.kind === 'release' ? 'k1-btn--primary' : 'k1-btn--danger'}`} onClick={onConfirm}>{confirmCopy?.action}</button>
        </footer>
      </Dialog>
    </div>
  )
}

function SwitchRow({ label, hint, checked, disabled, pending, onChange }: { label: string; hint: string; checked: boolean; disabled: boolean; pending: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="k1-prod-switch">
      <span>
        <strong>{label}{pending && <Spinner size={12} />}</strong>
        <small>{hint}</small>
      </span>
      <Switch checked={checked} disabled={disabled} label={label} onChange={onChange} />
    </div>
  )
}

function BatchCard({ controls, editable, busy, onRelease, onHold }: { controls: Controls; editable: boolean; busy: string | null; onRelease: (batch: Batch) => void; onHold: (batch: Batch) => void }) {
  const t = useCopy()
  const p = t.prod.control
  const { batch, release } = controls
  return (
    <Card title={p.batch} aside={<span className="k1-tag">{release === 'manual' ? p.manual : p.auto}</span>}>
      {!batch ? <p className="k1-hint">{p.noBatch}</p> : (
        <div className="k1-prod-batch">
          <div className="k1-prod-batch__head">
            <strong>{p.batchOf(fmtNum(batch.total))}</strong>
            <span className={`k1-status k1-status--batch-${batch.status}`}>{p.batchStatus[batch.status]}</span>
          </div>
          <span className="k1-hint">{p.proposedAt(fmtTime(batch.created_at))}</span>
          <div className="k1-prod-batch__split">
            <dl aria-label={p.byStation}>
              <span className="k1-label">{p.byStation}</span>
              {batch.by_station.map((row) => <div key={row.station}><dt>{row.station}</dt><dd>{fmtNum(row.count)}</dd></div>)}
            </dl>
            <dl aria-label={p.byMessage}>
              <span className="k1-label">{p.byMessage}</span>
              {batch.by_message.map((row) => <div key={row.step}><dt>{stepLabel(row.step)}</dt><dd>{fmtNum(row.count)}</dd></div>)}
            </dl>
          </div>
          {release === 'manual' ? (
            <div className="k1-prod-batch__actions">
              <p className="k1-hint">{batch.status === 'proposed' ? p.nothingSends : batch.status === 'held' || batch.status === 'cancelled' ? p.heldNote : p.releasedNote}</p>
              <button type="button" className="k1-btn k1-btn--outline" disabled={!editable || batch.status !== 'proposed' || busy !== null} aria-busy={busy === 'hold'} onClick={() => onHold(batch)}>
                {busy === 'hold' && <Spinner />}{p.hold}
              </button>
              <button type="button" className="k1-btn k1-btn--primary" disabled={!editable || batch.status !== 'proposed' || busy !== null} aria-busy={busy === 'release'} onClick={() => onRelease(batch)}>
                {busy === 'release' && <Spinner />}{['released', 'sending', 'sent'].includes(batch.status) ? p.releasedButton : p.release}
              </button>
            </div>
          ) : <p className="k1-hint">{p.autoNote}</p>}
        </div>
      )}
    </Card>
  )
}
