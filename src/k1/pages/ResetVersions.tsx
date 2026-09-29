import { useId, useRef, useState } from 'react'
import type { AgentConfig } from '../data/agentConfig'
import { describeError } from '../data/agentConfig'
import { clearCaches, resetVersions } from '../data/builderApi'
import { useCopy } from '../i18n'
import { Spinner } from '../ui/controls'
import { Dialog } from '../ui/overlay'

type Notify = (toast: { title: string; body: string; tone?: 'success' | 'error' }) => void

export function ResetVersions({ config, dirty, notify, onReset }: {
  config: AgentConfig
  dirty: boolean
  notify: Notify
  onReset: () => void
}) {
  const t = useCopy()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const ids = { title: useId(), input: useId(), error: useId() }

  const count = config.versions.length
  const latest = config.versions[0]?.number ?? 1
  // The existing reset RPC clears the old deployment marker along with requests.
  // It must not remove a version other than the current saved one.
  const blockedByLive = count > 1 && config.versions[0]?.id !== config.versions.find((version) => version.active)?.id
  const chats = config.versions.reduce((sum, version) => sum + version.conversations, 0)
  const word = t.reset.word
  const matches = typed.trim().toUpperCase() === word

  const close = () => {
    if (busy) return
    setOpen(false)
    setTyped('')
    setError('')
  }

  const confirm = async () => {
    if (!matches || busy || blockedByLive) return
    setBusy(true)
    setError('')
    try {
      const result = await resetVersions()
      clearCaches()
      notify({ title: t.reset.done, body: t.reset.doneBody(result.removedChats) })
      setOpen(false)
      setTyped('')
      onReset()
    } catch (failure) {
      setError(t.reset.failedBody(describeError(failure)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="k1-danger" aria-labelledby={ids.title}>
      <h2 id={ids.title} className="k1-section-title">{t.reset.zone}</h2>
      <div className="k1-danger__card">
        <div className="k1-danger__text">
          <strong>{t.reset.title}</strong>
          <p>{blockedByLive ? t.reset.blockedByLive : count > 1 ? t.reset.body : t.reset.onlyOne}</p>
        </div>
        <button type="button" className="k1-btn k1-btn--outline k1-btn--sm k1-danger__button" aria-haspopup="dialog" disabled={count <= 1 || blockedByLive} onClick={() => setOpen(true)}>
          {t.reset.button}
        </button>
      </div>

      <Dialog open={open} title={t.reset.dialogTitle} onClose={close} width={480} initialFocus={inputRef}>
        <div className="k1-form-stack">
          <ul className="k1-danger__list">
            <li>{t.reset.versions(count, latest)}</li>
            <li>{chats ? t.reset.chats(chats) : t.reset.requests}</li>
            {chats > 0 && <li>{t.reset.requests}</li>}
            <li>{t.reset.live}</li>
            {dirty && <li>{t.reset.draft}</li>}
          </ul>
          <p className="k1-danger__final">{t.reset.final}</p>
          <div className="k1-field">
            <label htmlFor={ids.input}>{t.reset.typeLabel(word)}</label>
            <input
              ref={inputRef}
              id={ids.input}
              className="k1-input"
              value={typed}
              autoComplete="off"
              spellCheck={false}
              aria-describedby={error ? ids.error : undefined}
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') void confirm() }}
            />
          </div>
          {error && <p id={ids.error} className="k1-auth__error" role="alert">{error}</p>}
        </div>
        <footer className="k1-dialog__foot">
          <button type="button" className="k1-btn k1-btn--outline" onClick={close} disabled={busy}>{t.common.cancel}</button>
          <button type="button" className="k1-btn k1-btn--danger" onClick={() => void confirm()} disabled={!matches || busy} aria-busy={busy}>
            {busy && <Spinner />}{t.reset.confirm}
          </button>
        </footer>
      </Dialog>
    </section>
  )
}
