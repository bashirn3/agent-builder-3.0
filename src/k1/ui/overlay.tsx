import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { createContext, ReactNode, RefObject, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { ease, fade, sheetMotion } from '../../lib/motion'

const LayerContext = createContext<HTMLElement | null>(null)

export function LayerProvider({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLElement | null>(null)
  return (
    <LayerContext.Provider value={host}>
      {children}
      <div ref={setHost} className="k1-layer" />
    </LayerContext.Provider>
  )
}

export function useLayer() {
  return useContext(LayerContext)
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

const layerStack: symbol[] = []

function useLayerToken() {
  const token = useRef(Symbol('layer')).current
  useEffect(() => {
    layerStack.push(token)
    return () => {
      const index = layerStack.lastIndexOf(token)
      if (index >= 0) layerStack.splice(index, 1)
    }
  }, [token])
  return () => layerStack[layerStack.length - 1] === token
}

export function useFocusTrap(rootRef: RefObject<HTMLElement | null>, onEscape: () => void, initialFocus?: RefObject<HTMLElement | null>) {
  const escapeRef = useRef(onEscape)
  escapeRef.current = onEscape
  const isTop = useLayerToken()
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const root = rootRef.current
    const first = initialFocus?.current ?? root?.querySelector<HTMLElement>(FOCUSABLE)
    first?.focus({ preventScroll: true })
    const onKey = (event: KeyboardEvent) => {
      if (!rootRef.current || !isTop()) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        escapeRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const nodes = [...rootRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((node) => node.offsetParent !== null || node === document.activeElement)
      if (!nodes.length) return
      const head = nodes[0]
      const tail = nodes[nodes.length - 1]
      if (!rootRef.current.contains(document.activeElement)) {
        event.preventDefault()
        head.focus()
      } else if (event.shiftKey && document.activeElement === head) {
        event.preventDefault()
        tail.focus()
      } else if (!event.shiftKey && document.activeElement === tail) {
        event.preventDefault()
        head.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true })
    }
  }, [])
}

type DialogProps = {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  width?: number
  initialFocus?: RefObject<HTMLElement | null>
}

export function Dialog(props: DialogProps) {
  const layer = useLayer()
  if (!layer) return null
  return createPortal(<AnimatePresence>{props.open && <DialogSurface key="dialog" {...props} />}</AnimatePresence>, layer)
}

function DialogSurface({ title, onClose, children, width = 460, initialFocus }: DialogProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const reduce = useReducedMotion()
  useFocusTrap(rootRef, onClose, initialFocus)
  return (
    <div className="k1-overlay k1-overlay--center">
      <motion.div
        className="k1-backdrop"
        aria-hidden="true"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={fade}
      />
      <motion.div
        ref={rootRef}
        className="k1-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{ width }}
        initial={{ opacity: 0, scale: 0.97, y: 6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 6 }}
        transition={{ duration: 0.2, ease }}
      >
        <h2 id={titleId} className="k1-dialog__title">{title}</h2>
        <button type="button" className="k1-dialog__close" aria-label="Close" onClick={onClose}>
          <X size={16} strokeWidth={1.75} />
        </button>
        {children}
      </motion.div>
    </div>
  )
}

type DrawerProps = {
  open: boolean
  side: 'left' | 'bottom'
  label: string
  onClose: () => void
  children: ReactNode
}

export function Drawer(props: DrawerProps) {
  const layer = useLayer()
  if (!layer) return null
  return createPortal(<AnimatePresence>{props.open && <DrawerSurface key="drawer" {...props} />}</AnimatePresence>, layer)
}

function DrawerSurface({ side, label, onClose, children }: DrawerProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  useFocusTrap(rootRef, onClose)
  const reduce = useReducedMotion()
  const hidden = side === 'left' ? { x: '-100%' } : { y: '100%' }
  return (
    <div className={`k1-overlay k1-overlay--${side}`}>
      <motion.div
        className="k1-backdrop"
        aria-hidden="true"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={fade}
      />
      <motion.div
        ref={rootRef}
        className={`k1-drawer k1-drawer--${side}`}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        initial={reduce ? { opacity: 0 } : hidden}
        animate={{ x: 0, y: 0, opacity: 1 }}
        exit={reduce ? { opacity: 0 } : hidden}
        transition={{ ...sheetMotion, duration: 0.28 }}
      >
        {children}
      </motion.div>
    </div>
  )
}

export function Collapse({ open, children, id }: { open: boolean; children: ReactNode; id?: string }) {
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          id={id}
          key="collapse"
          className="k1-collapse"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ height: { duration: 0.22, ease }, opacity: { duration: 0.16, ease } }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

type PopoverProps = {
  open: boolean
  anchorRef: RefObject<HTMLElement | null>
  onClose: () => void
  children: ReactNode
  align?: 'start' | 'end'
  matchWidth?: boolean
  className?: string
  role?: string
  label?: string
}

export function Popover(props: PopoverProps) {
  const layer = useLayer()
  if (!layer) return null
  return createPortal(<AnimatePresence>{props.open && <PopoverSurface key="popover" {...props} />}</AnimatePresence>, layer)
}

function PopoverSurface({ anchorRef, onClose, children, align = 'start', matchWidth, className, role, label }: PopoverProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<{ top: number; left: number; width: number; above: boolean } | null>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const isTop = useLayerToken()
  const reduce = useReducedMotion()

  useLayoutEffect(() => {
    const place = () => {
      const anchor = anchorRef.current
      const panel = rootRef.current
      if (!anchor) return
      const rect = anchor.getBoundingClientRect()
      const panelHeight = panel?.offsetHeight ?? 0
      const panelWidth = matchWidth ? rect.width : panel?.offsetWidth ?? rect.width
      const above = rect.bottom + 6 + panelHeight > window.innerHeight - 8 && rect.top - 6 - panelHeight > 8
      const rawLeft = align === 'end' ? rect.right - panelWidth : rect.left
      const left = Math.max(8, Math.min(rawLeft, window.innerWidth - panelWidth - 8))
      setBox({ top: above ? rect.top - 6 - panelHeight : rect.bottom + 6, left, width: rect.width, above })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [align, anchorRef, matchWidth])

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      if (!isTop()) return
      const target = event.target as Node
      if (rootRef.current?.contains(target) || anchorRef.current?.contains(target)) return
      closeRef.current()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !isTop()) return
      event.preventDefault()
      event.stopPropagation()
      closeRef.current()
      anchorRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointer, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onPointer, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [anchorRef])

  return (
    <motion.div
      ref={rootRef}
      className={`k1-popover${className ? ` ${className}` : ''}`}
      role={role}
      aria-label={label}
      style={{
        top: box?.top ?? -9999,
        left: box?.left ?? -9999,
        width: matchWidth ? box?.width : undefined,
        transformOrigin: box?.above ? 'bottom left' : 'top left',
      }}
      initial={{ opacity: 0, scale: 0.97, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: -4 }}
      transition={{ duration: 0.16, ease }}
    >
      {children}
    </motion.div>
  )
}
