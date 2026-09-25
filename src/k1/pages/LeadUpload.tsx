import { AnimatePresence, motion } from 'motion/react'
import { useId, useRef, useState, type DragEvent } from 'react'
import { ease } from '../../lib/motion'
import { describeError } from '../data/agentConfig'
import { importLeads, type LeadRow } from '../data/builderApi'
import { FIELD_LABELS, readLeads, type ParseResult } from '../data/csv'
import { shortStation } from '../data/fixtures'
import { formatDate } from '../data/language'
import { Spinner } from '../ui/controls'
import { Upload } from '../ui/icons'
import { Dialog } from '../ui/overlay'
import { copy, useCopy } from '../i18n'

const PREVIEW_ROWS = 5

export function LeadPreview({ rows }: { rows: LeadRow[] }) {
  const t = useCopy()
  return (
    <div className="k1-upload__preview">
      <table className="k1-table">
        <thead>
          <tr>{(['PlateNumber', 'StationName', 'NextInspectionDateRangeEnd', 'Language', 'PhoneNumber'] as const).map((field) => <th key={field} scope="col">{t.upload.fields[field] ?? FIELD_LABELS[field]}</th>)}</tr>
        </thead>
        <tbody>
          {rows.slice(0, PREVIEW_ROWS).map((row, index) => (
            <tr key={index}>
              <th scope="row">{row.PlateNumber}</th>
              <td>{shortStation(row.StationName) || '—'}{row.isClosed && <span className="k1-tag k1-tag--danger k1-table__tag">{t.upload.closed}</span>}</td>
              <td className="k1-table__num">{formatDate(row.NextInspectionDateRangeEnd, 'fi') || '—'}</td>
              <td>{row.Language || '—'}</td>
              <td className="k1-table__num">{row.PhoneNumber || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > PREVIEW_ROWS && <p className="k1-hint">{t.upload.andMore(rows.length - PREVIEW_ROWS)}</p>}
    </div>
  )
}

export function LeadUploadDialog({ open, onClose, onImported, notify }: {
  open: boolean
  onClose: () => void
  onImported: () => void
  notify: (toast: { title: string; body: string; tone?: 'success' | 'error' }) => void
}) {
  const t = useCopy()
  const [file, setFile] = useState<string | null>(null)
  const [result, setResult] = useState<ParseResult | null>(null)
  const [dragging, setDragging] = useState(false)
  const [importing, setImporting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const inputId = useId()
  const hintId = useId()

  const reset = () => { setFile(null); setResult(null); setDragging(false) }
  const close = () => { if (!importing) { reset(); onClose() } }

  const read = async (picked: File | undefined) => {
    if (!picked) return
    if (!/\.(csv|txt)$/i.test(picked.name) && !/csv|text/.test(picked.type)) {
      setFile(picked.name)
      setResult({ rows: [], skipped: [], missing: [], error: copy().upload.chooseCsv })
      return
    }
    setFile(picked.name)
    setResult(readLeads(await picked.text(), copy().upload))
  }

  const onDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    setDragging(false)
    void read(event.dataTransfer.files[0])
  }

  const submit = async () => {
    if (!result?.rows.length) return
    setImporting(true)
    try {
      const { inserted, updated } = await importLeads(result.rows)
      notify({
        title: t.upload.imported(inserted + updated),
        body: updated ? t.upload.importedUpdated(inserted, updated) : t.upload.importedBody,
      })
      onImported()
      reset()
      onClose()
    } catch (error) {
      notify({ tone: 'error', title: t.upload.importFailed, body: t.upload.importFailedBody(describeError(error)) })
    } finally {
      setImporting(false)
    }
  }

  const ready = result?.rows.length ?? 0

  return (
    <Dialog open={open} title={t.upload.title} onClose={close} width={680}>
      <div className="k1-form-stack">
        <label
          htmlFor={inputId}
          className={`k1-dropzone${dragging ? ' is-dragging' : ''}`}
          onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <span className="k1-dropzone__icon" aria-hidden="true"><Upload size={18} strokeWidth={1.75} /></span>
          <span className="k1-dropzone__text">
            <strong>{file ?? t.upload.drop}</strong>
            <small id={hintId}>{t.upload.columns}</small>
          </span>
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept=".csv,text/csv"
            className="k1-visually-hidden"
            aria-describedby={hintId}
            onChange={(event) => { void read(event.target.files?.[0]); event.target.value = '' }}
          />
        </label>

        <AnimatePresence initial={false} mode="wait">
          {result && (
            <motion.div key={file ?? 'result'} className="k1-upload__result" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18, ease }}>
              {result.error ? (
                <p className="k1-auth__error" role="alert">{result.error}</p>
              ) : (
                <p className="k1-upload__summary" role="status">
                  <strong>{t.upload.ready(ready)}</strong>
                  {result.skipped.length > 0 && <span> · {t.upload.skipped(result.skipped.length)}</span>}
                  {result.missing.length > 0 && <span> · {t.upload.missing(result.missing.join(', '))}</span>}
                </p>
              )}
              {ready > 0 && <LeadPreview rows={result.rows} />}
              {result.skipped.length > 0 && (
                <ul className="k1-upload__skipped">
                  {result.skipped.slice(0, 3).map((row) => <li key={row.line}>{t.upload.row(row.line, row.reason)}</li>)}
                  {result.skipped.length > 3 && <li>{t.upload.andMore(result.skipped.length - 3)}</li>}
                </ul>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <footer className="k1-dialog__foot">
        <button type="button" className="k1-btn k1-btn--outline" onClick={close} disabled={importing}>{t.common.cancel}</button>
        <button type="button" className="k1-btn k1-btn--primary" onClick={() => void submit()} disabled={!ready || importing} aria-busy={importing}>
          {importing && <Spinner />}{ready ? t.upload.importCount(ready) : t.upload.import}
        </button>
      </footer>
    </Dialog>
  )
}
