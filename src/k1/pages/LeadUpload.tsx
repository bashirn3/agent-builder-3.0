import { AnimatePresence, motion } from 'motion/react'
import { useId, useRef, useState, type DragEvent } from 'react'
import { ease } from '../../lib/motion'
import { describeError } from '../data/agentConfig'
import { importLeads } from '../data/builderApi'
import { FIELD_LABELS, readLeads, type ParseResult } from '../data/csv'
import { Spinner } from '../ui/controls'
import { Upload } from '../ui/icons'
import { Dialog } from '../ui/overlay'

const PREVIEW_ROWS = 5

export function LeadUploadDialog({ open, onClose, onImported, notify }: {
  open: boolean
  onClose: () => void
  onImported: () => void
  notify: (toast: { title: string; body: string; tone?: 'success' | 'error' }) => void
}) {
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
      setResult({ rows: [], skipped: [], missing: [], error: 'Choose a .csv file.' })
      return
    }
    setFile(picked.name)
    setResult(readLeads(await picked.text()))
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
        title: `${inserted + updated} lead${inserted + updated === 1 ? '' : 's'} imported`,
        body: updated ? `${inserted} new, ${updated} updated because the registration was already in the list.` : 'They are now in Leads and in the test chat lead picker.',
      })
      onImported()
      reset()
      onClose()
    } catch (error) {
      notify({ tone: 'error', title: 'Import failed', body: `Nothing was imported (${describeError(error)}). Try again.` })
    } finally {
      setImporting(false)
    }
  }

  const ready = result?.rows.length ?? 0

  return (
    <Dialog open={open} title="Upload CSV" onClose={close} width={680}>
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
            <strong>{file ?? 'Drop a CSV file here, or choose a file'}</strong>
            <small id={hintId}>Columns: name, email, phone, registration, inspection due date</small>
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
                  <strong>{ready} lead{ready === 1 ? '' : 's'} ready</strong>
                  {result.skipped.length > 0 && <span> · {result.skipped.length} row{result.skipped.length === 1 ? '' : 's'} skipped</span>}
                  {result.missing.length > 0 && <span> · no {result.missing.map((field) => FIELD_LABELS[field].toLowerCase()).join(', ')} column</span>}
                </p>
              )}
              {ready > 0 && (
                <div className="k1-upload__preview">
                  <table className="k1-table">
                    <thead>
                      <tr>{(['name', 'email', 'phone', 'registration', 'inspection_due'] as const).map((field) => <th key={field} scope="col">{FIELD_LABELS[field]}</th>)}</tr>
                    </thead>
                    <tbody>
                      {result.rows.slice(0, PREVIEW_ROWS).map((row, index) => (
                        <tr key={index}>
                          <th scope="row">{row.name}</th>
                          <td>{row.email || '—'}</td>
                          <td>{row.phone || '—'}</td>
                          <td>{row.registration}</td>
                          <td className="k1-table__num">{row.inspection_due || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {ready > PREVIEW_ROWS && <p className="k1-hint">and {ready - PREVIEW_ROWS} more</p>}
                </div>
              )}
              {result.skipped.length > 0 && (
                <ul className="k1-upload__skipped">
                  {result.skipped.slice(0, 3).map((row) => <li key={row.line}>Row {row.line}: {row.reason}</li>)}
                  {result.skipped.length > 3 && <li>and {result.skipped.length - 3} more</li>}
                </ul>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <footer className="k1-dialog__foot">
        <button type="button" className="k1-btn k1-btn--outline" onClick={close} disabled={importing}>Cancel</button>
        <button type="button" className="k1-btn k1-btn--primary" onClick={() => void submit()} disabled={!ready || importing} aria-busy={importing}>
          {importing && <Spinner />}{ready ? `Import ${ready} lead${ready === 1 ? '' : 's'}` : 'Import'}
        </button>
      </footer>
    </Dialog>
  )
}
