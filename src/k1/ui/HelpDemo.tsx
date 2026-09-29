import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { useCopy } from '../i18n'
import { Dialog } from './overlay'

// Supademo needs /embed/ with embed_v=2 inside the iframe; /demo/ is the full-page share link.
const DEMO_ID = 'cmukzff181159qmbad82vgf5f'
const EMBED_URL = `https://app.supademo.com/embed/${DEMO_ID}?embed_v=2&utm_source=embed`
const OPEN_URL = `https://app.supademo.com/demo/${DEMO_ID}?utm_source=embed`

// Kept above page content but below dialogs; draggable so it never blocks a control.
export function HelpDemo() {
  const t = useCopy()
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null)
  const drag = useRef<{ pointerId: number; startX: number; startY: number; x: number; y: number; moved: boolean } | null>(null)
  const suppressClick = useRef(false)

  useEffect(() => {
    if (open) setLoaded(false)
  }, [open])

  const onPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const rect = event.currentTarget.getBoundingClientRect()
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: rect.left, y: rect.top, moved: false }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const onPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    if (Math.hypot(event.clientX - current.startX, event.clientY - current.startY) > 5) current.moved = true
    if (!current.moved) return
    const margin = 8
    setPosition({
      x: Math.max(margin, Math.min(window.innerWidth - event.currentTarget.offsetWidth - margin, current.x + event.clientX - current.startX)),
      y: Math.max(margin, Math.min(window.innerHeight - event.currentTarget.offsetHeight - margin, current.y + event.clientY - current.startY)),
    })
  }

  const onPointerUp = (event: PointerEvent<HTMLButtonElement>) => {
    if (drag.current?.pointerId !== event.pointerId) return
    suppressClick.current = drag.current.moved
    drag.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return (
    <>
      <button
        type="button"
        className="k1-help-fab"
        style={position ? { left: position.x, top: position.y, right: 'auto', bottom: 'auto' } : undefined}
        aria-label={t.help.open}
        aria-haspopup="dialog"
        title={t.help.open}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { drag.current = null }}
        onClick={() => { if (suppressClick.current) { suppressClick.current = false; return } setOpen(true) }}
      >
        <span aria-hidden="true">?</span>
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
