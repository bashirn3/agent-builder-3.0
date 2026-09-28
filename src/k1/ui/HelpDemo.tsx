import { useEffect, useState } from 'react'
import { useCopy } from '../i18n'
import { Dialog } from './overlay'

// Supademo needs /embed/ with embed_v=2 inside the iframe; /demo/ is the full-page share link.
const DEMO_ID = 'cmukzff181159qmbad82vgf5f'
const EMBED_URL = `https://app.supademo.com/embed/${DEMO_ID}?embed_v=2&utm_source=embed`
const OPEN_URL = `https://app.supademo.com/demo/${DEMO_ID}?utm_source=embed`

// Floating only where nothing is pinned to the bottom (auth pages); the workspace has
// save bars and composers bottom-right, so it uses the header trigger instead.
export function HelpDemo({ placement = 'floating' }: { placement?: 'floating' | 'header' }) {
  const t = useCopy()
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (open) setLoaded(false)
  }, [open])

  return (
    <>
      <button
        type="button"
        className={placement === 'header' ? 'k1-help-trigger' : 'k1-help-fab'}
        aria-label={t.help.open}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
      >
        <span aria-hidden="true">?</span>
        {placement === 'header' && <span className="k1-help-trigger__label" aria-hidden="true">{t.help.open}</span>}
      </button>
      <Dialog open={open} title={t.help.title} onClose={() => setOpen(false)} width={920}>
        <div className="k1-help__embed">
          {!loaded && <div className="k1-help__loading" aria-hidden="true">{t.help.loading}</div>}
          <iframe src={EMBED_URL} title={t.help.frame} allow="clipboard-write; fullscreen" allowFullScreen onLoad={() => setLoaded(true)} />
        </div>
        <div className="k1-dialog__foot">
          <a className="k1-link k1-help__newtab" href={OPEN_URL} target="_blank" rel="noopener noreferrer">{t.help.newTab}</a>
        </div>
      </Dialog>
    </>
  )
}
