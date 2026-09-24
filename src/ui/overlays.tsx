import { animate } from 'motion'
import { motion, useReducedMotion } from 'motion/react'
import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ease, fade, sheetMotion, space } from '../lib/motion'
import { ChevronIcon, CloseIcon } from './icons'

function focusableIn(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>('button, [href], textarea, input, select')]
    .filter((node) => !node.hasAttribute('disabled') && node.tabIndex !== -1)
}

export function useOverlayChrome(onClose: () => void) {
  const rootRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab' || !rootRef.current) return
      const nodes = focusableIn(rootRef.current)
      if (nodes.length === 0) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      previous?.focus?.()
    }
  }, [])
  return rootRef
}

function usePresence(open: boolean) {
  const [present, setPresent] = useState(open)
  useEffect(() => {
    if (open) setPresent(true)
  }, [open])
  return [present, setPresent] as const
}

export function Dialog({
  open,
  title,
  labelledBy,
  wide,
  onClose,
  children,
}: {
  open: boolean
  title?: string
  labelledBy: string
  wide?: boolean
  onClose: () => void
  children: ReactNode
}) {
  const reducedMotion = useReducedMotion()
  const [present, setPresent] = usePresence(open)
  const rootRef = useOverlayChrome(onClose)
  const closeRef = useRef<HTMLButtonElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open && present) closeRef.current?.focus()
  }, [open, present])

  useLayoutEffect(() => {
    const backdrop = backdropRef.current
    const panel = panelRef.current
    if (!present || !backdrop || !panel) return
    if (reducedMotion) {
      if (!open) setPresent(false)
      return
    }
    if (open) {
      animate(backdrop, { opacity: [0, 1] }, fade)
      animate(panel, { opacity: [0, 1], transform: ['scale(0.97)', 'scale(1)'], filter: ['blur(4px)', 'blur(0px)'] }, { duration: 0.2, ease })
      return
    }
    const fadeOut = animate(backdrop, { opacity: 0 }, fade)
    const scaleOut = animate(panel, { opacity: 0, transform: 'scale(0.97)', filter: 'blur(4px)' }, { duration: 0.2, ease })
    const done = () => setPresent(false)
    const timer = window.setTimeout(done, 280)
    void Promise.all([fadeOut.finished, scaleOut.finished]).then(() => {
      window.clearTimeout(timer)
      done()
    })
  }, [open, present, reducedMotion, setPresent])

  if (!present) return null
  return (
    <div ref={rootRef} className="overlay-root">
      <div ref={backdropRef} className="overlay-backdrop" aria-hidden="true" onClick={onClose} />
      <div
        ref={panelRef}
        className={`dialog-panel${wide ? ' is-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
      >
        <header className="dialog-head">
          <h2 id={labelledBy}>{title}</h2>
          <button ref={closeRef} className="icon-button" type="button" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </header>
        {children}
      </div>
    </div>
  )
}

export function Drawer({
  open,
  side,
  labelledBy,
  onClose,
  children,
}: {
  open: boolean
  side: 'left' | 'bottom'
  labelledBy: string
  onClose: () => void
  children: ReactNode
}) {
  const reducedMotion = useReducedMotion()
  const [present, setPresent] = usePresence(open)
  const rootRef = useOverlayChrome(onClose)
  const closeRef = useRef<HTMLButtonElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open && present) closeRef.current?.focus()
  }, [open, present])

  useLayoutEffect(() => {
    const backdrop = backdropRef.current
    const panel = panelRef.current
    if (!present || !backdrop || !panel) return
    const hidden = side === 'left' ? 'translateX(-16px)' : 'translateY(16px)'
    if (reducedMotion) {
      if (!open) setPresent(false)
      return
    }
    if (open) {
      animate(backdrop, { opacity: [0, 1] }, fade)
      animate(panel, { transform: [hidden, 'translate(0, 0)'] }, sheetMotion)
      return
    }
    const fadeOut = animate(backdrop, { opacity: 0 }, fade)
    const slideOut = animate(panel, { transform: hidden }, sheetMotion)
    const done = () => setPresent(false)
    const timer = window.setTimeout(done, 280)
    void Promise.all([fadeOut.finished, slideOut.finished]).then(() => {
      window.clearTimeout(timer)
      done()
    })
  }, [open, present, reducedMotion, setPresent, side])

  if (!present) return null
  return (
    <div ref={rootRef} className={`overlay-root drawer-${side}`} role="presentation">
      <div ref={backdropRef} className="overlay-backdrop" aria-hidden="true" onClick={onClose} />
      <div
        ref={panelRef}
        className={`drawer-panel drawer-${side}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
      >
        <button ref={closeRef} className="visually-hidden" type="button" onClick={onClose}>
          Close
        </button>
        {children}
      </div>
    </div>
  )
}

export function Accordion({
  id,
  title,
  open,
  onToggle,
  children,
}: {
  id: string
  title: string
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  const reducedMotion = useReducedMotion()
  const [clip, setClip] = useState(!open)
  const buttonId = `${id}-toggle`
  const panelId = `${id}-panel`
  return (
    <section className={`accordion${open ? ' is-open' : ''}`}>
      <button id={buttonId} type="button" className="accordion-toggle" aria-expanded={open} aria-controls={panelId} onClick={onToggle}>
        {title}
        <motion.span className="accordion-chevron" aria-hidden="true" animate={{ rotate: open ? 180 : 0 }} transition={reducedMotion ? { duration: 0 } : space}>
          <ChevronIcon />
        </motion.span>
      </button>
      <motion.div
        id={panelId}
        role="region"
        aria-labelledby={buttonId}
        initial={false}
        animate={open ? 'open' : 'closed'}
        variants={{ open: { height: 'auto', opacity: 1 }, closed: { height: 0, opacity: 0 } }}
        transition={reducedMotion ? { duration: 0 } : { height: space, opacity: { duration: 0.18, ease } }}
        style={{ overflow: clip ? 'hidden' : 'visible' }}
        onAnimationStart={() => setClip(true)}
        onAnimationComplete={() => { if (open) setClip(false) }}
        {...(open ? {} : { inert: true })}
      >
        <div className="accordion-body">{children}</div>
      </motion.div>
    </section>
  )
}
